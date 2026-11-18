import { describe, expect, it } from "vitest";
import { AttentionDiff, attentionPath, attentionResponseSchema } from "./attention.js";
import { deviceOrigins, discoverServers } from "./discovery.js";
import type { Identity, Probe, ProbeResult } from "./identity.js";
import { identitySchema, probeIdentity } from "./identity.js";
import { connectAddress, normalizeAddress, reopenSaved } from "./remote.js";
import { findTailscaleCli, parseTailnetStatus, readTailnet } from "./tailscale.js";

/*
 * 원격 모드의 발견·연결(research 0013, Q13)과 알림 사건 고르기(Q4). Tailscale CLI 출력과 신원 확인 응답은 흉내 낸
 * 값이고 기기 이름은 가상 값(example.ts.net)이다.
 */

const identity = (instanceId: string, extra: Partial<Identity> = {}): ProbeResult => ({
  kind: "ours",
  identity: {
    product: "factory-orchestrator",
    version: "0.1.0",
    instanceId,
    webAccess: "allowed",
    ...extra,
  },
});

/** origin → 응답. 없는 origin 은 닿지 않음 */
function fakeProbe(answers: Record<string, ProbeResult>, asked: string[] = []): Probe {
  return (origin) => {
    asked.push(origin);
    return Promise.resolve(answers[origin] ?? { kind: "unreachable" });
  };
}

const STATUS = JSON.stringify({
  BackendState: "Running",
  MagicDNSSuffix: "example.ts.net",
  Self: { HostName: "laptop", DNSName: "laptop.example.ts.net.", Online: true },
  Peer: {
    "nodekey:a": {
      HostName: "build-box",
      DNSName: "build-box.example.ts.net.",
      OS: "linux",
      Online: true,
    },
    "nodekey:b": { HostName: "mini", DNSName: "mini.example.ts.net.", OS: "macOS", Online: true },
    "nodekey:c": { HostName: "phone", DNSName: "phone.example.ts.net.", OS: "iOS", Online: true },
    "nodekey:d": { HostName: "nas", DNSName: "nas.example.ts.net.", OS: "linux", Online: false },
    "nodekey:e": {
      HostName: "",
      DNSName: "printer.example.ts.net.",
      OS: "linux",
      Online: true,
      Extra: 1,
    },
  },
});

describe("Tailscale 상태 읽기", () => {
  it("Online 이고 휴대폰이 아닌 기기만 고르고, DNSName 끝의 점을 뗀다", () => {
    expect(parseTailnetStatus(STATUS)).toEqual({
      kind: "running",
      devices: [
        { name: "build-box", host: "build-box.example.ts.net" },
        { name: "mini", host: "mini.example.ts.net" },
        { name: "printer", host: "printer.example.ts.net" },
      ],
    });
  });

  it("Running 이 아니면 꺼짐, 모양이 다르면 읽지 못함이다", () => {
    expect(parseTailnetStatus(JSON.stringify({ BackendState: "NeedsLogin", Peer: null }))).toEqual({
      kind: "stopped",
    });
    expect(parseTailnetStatus("{")).toEqual({ kind: "unreadable" });
    expect(parseTailnetStatus(JSON.stringify({ Peer: {} }))).toEqual({ kind: "unreadable" });
  });

  it("알려진 위치에서 CLI 를 찾고, 없으면 없음이다", async () => {
    const env = {};
    expect(findTailscaleCli({ env, exists: (p) => p === "/opt/homebrew/bin/tailscale" })).toBe(
      "/opt/homebrew/bin/tailscale",
    );
    expect(findTailscaleCli({ env: { FACTORY_TAILSCALE_CLI: "/x/ts" }, exists: () => true })).toBe(
      "/x/ts",
    );
    expect(await readTailnet({ env, exists: () => false, run: () => Promise.resolve("") })).toEqual(
      {
        kind: "missing",
      },
    );
    const calls: string[][] = [];
    await readTailnet({
      env,
      exists: () => true,
      run: (file, args) => {
        calls.push([file, ...args]);
        return Promise.resolve(undefined);
      },
    });
    expect(calls).toEqual([["/usr/local/bin/tailscale", "status", "--json"]]);
  });
});

describe("서버 찾기", () => {
  it("기기마다 3000 을 먼저, 그다음 443(Serve)을 묻는다", () => {
    expect(deviceOrigins("mini.example.ts.net", 3000)).toEqual([
      "http://mini.example.ts.net:3000",
      "https://mini.example.ts.net",
    ]);
  });

  it("우리 서버가 도는 기기만 목록에 보이고, 같은 서버는 하나로 묶는다", async () => {
    const asked: string[] = [];
    const result = await discoverServers({
      tailnet: () => Promise.resolve(parseTailnetStatus(STATUS)),
      probe: fakeProbe(
        {
          "https://build-box.example.ts.net": identity("inst-1", { version: "0.2.0" }),
          "http://mini.example.ts.net:3000": identity("inst-2", { webAccess: "host-not-allowed" }),
          "http://printer.example.ts.net:3000": { kind: "not-ours" },
        },
        asked,
      ),
    });
    expect(result).toEqual({
      kind: "found",
      servers: [
        {
          instanceId: "inst-1",
          name: "build-box",
          url: "https://build-box.example.ts.net",
          version: "0.2.0",
          webAccess: "allowed",
        },
        {
          instanceId: "inst-2",
          name: "mini",
          url: "http://mini.example.ts.net:3000",
          version: "0.1.0",
          webAccess: "host-not-allowed",
        },
      ],
    });
    // 3000 에서 찾은 기기는 443 을 묻지 않는다. 휴대폰·오프라인 기기는 묻지 않는다.
    expect(asked).not.toContain("https://mini.example.ts.net");
    expect(asked.some((origin) => origin.includes("phone") || origin.includes("nas"))).toBe(false);
  });

  it("다른 포트로 찾을 수 있다", async () => {
    const result = await discoverServers({
      port: 4100,
      tailnet: () =>
        Promise.resolve({
          kind: "running",
          devices: [{ name: "mini", host: "mini.example.ts.net" }],
        }),
      probe: fakeProbe({ "http://mini.example.ts.net:4100": identity("inst-2") }),
    });
    expect(result).toMatchObject({
      kind: "found",
      servers: [{ url: "http://mini.example.ts.net:4100" }],
    });
  });

  it("Tailscale 이 없거나 꺼졌으면 그대로 알려 주소 입력으로 넘어가게 한다", async () => {
    for (const kind of ["missing", "stopped", "unreadable"] as const) {
      expect(await discoverServers({ tailnet: () => Promise.resolve({ kind }) })).toEqual({ kind });
    }
  });
});

describe("신원 확인", () => {
  it("계약 모양을 읽고, 모르는 webAccess 는 열 수 없음으로 읽는다", () => {
    expect(
      identitySchema.parse({
        product: "factory-orchestrator",
        version: "1",
        instanceId: "x",
        webAccess: "new",
        more: 1,
      }),
    ).toEqual({
      product: "factory-orchestrator",
      version: "1",
      instanceId: "x",
      webAccess: "host-not-allowed",
    });
  });

  it("다른 서비스의 응답은 우리 서버가 아니다", async () => {
    const respond =
      (body: unknown, status = 200): typeof fetch =>
      () =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
    expect(await probeIdentity("http://a:1", 100, respond({ product: "other" }))).toEqual({
      kind: "not-ours",
    });
    expect(await probeIdentity("http://a:1", 100, respond({}, 404))).toEqual({ kind: "not-ours" });
    expect(
      await probeIdentity("http://a:1", 100, () => Promise.reject(new TypeError("fetch failed"))),
    ).toEqual({ kind: "unreachable" });
  });
});

describe("주소로 연결", () => {
  it("scheme 이 없으면 포트가 있을 때 http, 없을 때 https 로 본다", () => {
    expect(normalizeAddress("server.example.ts.net")).toBe("https://server.example.ts.net");
    expect(normalizeAddress("server.example.ts.net:3000/runs")).toBe(
      "http://server.example.ts.net:3000",
    );
    expect(normalizeAddress(" http://100.64.0.1:3000 ")).toBe("http://100.64.0.1:3000");
    expect(normalizeAddress("ftp://server")).toBeUndefined();
    expect(normalizeAddress("")).toBeUndefined();
  });

  it("우리 서버가 아니면 거절하고, 화면을 열 수 없는 주소도 까닭을 알린다", async () => {
    const probe = fakeProbe({
      "https://ours.example.ts.net": identity("inst-1"),
      "https://other.example.com": { kind: "not-ours" },
      "https://blocked.example.ts.net": identity("inst-2", { webAccess: "host-not-allowed" }),
    });
    expect(await connectAddress("ours.example.ts.net", probe)).toEqual({
      ok: true,
      server: {
        instanceId: "inst-1",
        name: "ours.example.ts.net",
        url: "https://ours.example.ts.net",
      },
    });
    expect(await connectAddress("other.example.com", probe)).toEqual({
      ok: false,
      reason: "not-ours",
    });
    expect(await connectAddress("blocked.example.ts.net", probe)).toEqual({
      ok: false,
      reason: "host-not-allowed",
    });
    expect(await connectAddress("gone.example.ts.net", probe)).toEqual({
      ok: false,
      reason: "unreachable",
    });
    expect(await connectAddress("::::", probe)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("저장한 서버 다시 열기", () => {
  const saved = {
    instanceId: "inst-1",
    name: "build-box",
    url: "http://build-box.example.ts.net:3000",
  };
  const none = () => Promise.resolve({ kind: "found" as const, servers: [] });

  it("저장한 주소가 같은 서버로 답하면 바로 연다", async () => {
    expect(
      await reopenSaved(saved, {
        probe: fakeProbe({ [saved.url]: identity("inst-1") }),
        discover: none,
      }),
    ).toEqual({ kind: "open", server: saved });
  });

  it("주소가 바뀌었으면 tailnet 에서 같은 서버를 찾아 새 주소로 연다", async () => {
    const result = await reopenSaved(saved, {
      probe: fakeProbe({}),
      discover: () =>
        Promise.resolve({
          kind: "found",
          servers: [
            {
              instanceId: "inst-1",
              name: "build-box",
              url: "https://build-box.example.ts.net",
              version: "0.1.0",
              webAccess: "allowed",
            },
          ],
        }),
    });
    expect(result).toEqual({
      kind: "open",
      server: { ...saved, url: "https://build-box.example.ts.net" },
    });
  });

  it("다른 서버가 그 주소에 있거나 찾지 못하면 닿지 않음이다", async () => {
    expect(
      await reopenSaved(saved, {
        probe: fakeProbe({ [saved.url]: identity("inst-9") }),
        discover: none,
      }),
    ).toEqual({ kind: "unreachable" });
    expect(
      await reopenSaved(saved, {
        probe: fakeProbe({}),
        discover: () => Promise.resolve({ kind: "missing" }),
      }),
    ).toEqual({
      kind: "unreachable",
    });
  });
});

describe("알림 사건", () => {
  const question = {
    kind: "question",
    key: "question:q-1",
    runId: "run-1",
    ticketKey: "ACME-1",
  } as const;
  const offline = {
    kind: "runner-offline",
    key: "runner-offline:r-1",
    runnerId: "r-1",
    runnerName: "mac-mini",
  } as const;
  const check = {
    kind: "human-check",
    key: "human-check:run-2",
    runId: "run-2",
    ticketKey: "ACME-2",
  } as const;

  it("처음 받은 응답은 기준으로만 삼고, 그 뒤 새로 생긴 사건만 알린다", () => {
    const diff = new AttentionDiff();
    expect(diff.next([question])).toEqual([]);
    expect(diff.next([question, check])).toEqual([check]);
    expect(diff.next([question, check])).toEqual([]);
    // 러너가 Online 이 됐다가 다시 Offline 이 되면 다시 알린다.
    expect(diff.next([question, check, offline])).toEqual([offline]);
    expect(diff.next([question, check])).toEqual([]);
    expect(diff.next([question, check, offline])).toEqual([offline]);
  });

  it("네 종류만 읽고 Merged·Failed 같은 다른 종류는 버린다", () => {
    const parsed = attentionResponseSchema.parse({
      events: [
        question,
        { kind: "merged", key: "merged:run-3", runId: "run-3", ticketKey: "ACME-3" },
        { kind: "failed" },
        offline,
      ],
    });
    expect(parsed.events).toEqual([question, offline]);
  });

  it("누르면 런 화면이나 Runners 를 연다", () => {
    expect(attentionPath(question)).toBe("/runs/run-1");
    expect(attentionPath(offline)).toBe("/runners");
  });
});

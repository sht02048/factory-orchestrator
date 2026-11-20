import { describe, expect, it } from "vitest";
import {
  WEBHOOK_PING_MAX_BYTES,
  checkWebhookAddress,
  funnelAddress,
  funnelCommand,
  parseWebhookAddress,
  webhookPingAnswer,
  webhookPingPath,
} from "./webhook-address.js";
import type { PingFetch } from "./webhook-address.js";

const INSTANCE = "instance-1";

interface Sent {
  url: string;
  init: RequestInit;
}

function server(answer: (url: string) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const fetch: PingFetch = (url, init) => {
    sent.push({ url, init });
    return Promise.resolve(answer(url));
  };
  return { fetch, sent };
}

function failing(error: unknown) {
  const sent: Sent[] = [];
  const fetch: PingFetch = (url, init) => {
    sent.push({ url, init });
    return Promise.reject(error);
  };
  return { fetch, sent };
}

function nodeError(code: string): TypeError {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
}

const thisServer = server((url) => {
  const asked = decodeURIComponent(url.split("/").pop() ?? "");
  return webhookPingAnswer(INSTANCE, asked);
});

describe("닿을 주소 확인하기", () => {
  it("주소로 이 서버의 확인 경로를 묻고, 이 설치가 답하면 주소를 돌려준다", async () => {
    const fake = server((url) =>
      webhookPingAnswer(INSTANCE, decodeURIComponent(url.split("/").pop() ?? "")),
    );
    await expect(
      checkWebhookAddress("https://Server.Example.ts.net:8443", {
        fetch: fake.fetch,
        instanceId: INSTANCE,
      }),
    ).resolves.toEqual({ ok: true, address: "https://server.example.ts.net:8443" });
    expect(fake.sent.map((s) => s.url)).toEqual([
      `https://server.example.ts.net:8443${webhookPingPath(INSTANCE)}`,
    ]);
    expect(fake.sent[0]?.init.redirect).toBe("manual");
    expect(fake.sent[0]?.init.method).toBe("GET");
  });

  it("다른 Ganger 설치가 답하면 다른 서버가 답한 것이다", async () => {
    const other = server((url) =>
      webhookPingAnswer("instance-2", decodeURIComponent(url.split("/").pop() ?? "")),
    );
    await expect(
      checkWebhookAddress("https://hooks.example.com", {
        fetch: other.fetch,
        instanceId: INSTANCE,
      }),
    ).resolves.toEqual({ ok: false, reason: "other-server" });
  });

  it("Ganger 가 아닌 서버가 200 으로 답해도 다른 서버다", async () => {
    for (const body of [
      "<html>hello</html>",
      JSON.stringify({ product: "other", match: true }),
      "",
    ]) {
      const page = server(() => new Response(body, { status: 200 }));
      await expect(
        checkWebhookAddress("https://hooks.example.com", {
          fetch: page.fetch,
          instanceId: INSTANCE,
        }),
      ).resolves.toEqual({ ok: false, reason: "other-server" });
    }
  });

  it("리다이렉트는 따라가지 않고 다른 서버로 본다", async () => {
    const redirect = server(
      () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1:3000/" } }),
    );
    await expect(
      checkWebhookAddress("https://hooks.example.com", {
        fetch: redirect.fetch,
        instanceId: INSTANCE,
      }),
    ).resolves.toEqual({ ok: false, reason: "other-server" });
    expect(redirect.sent).toHaveLength(1);
  });

  it("응답이 너무 크면 끝까지 읽지 않고 다른 서버로 본다", async () => {
    let pulled = 0;
    const huge = server(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulled += 1;
              controller.enqueue(new Uint8Array(512).fill(0x20));
            },
          }),
          { status: 200 },
        ),
    );
    await expect(
      checkWebhookAddress("https://hooks.example.com", { fetch: huge.fetch, instanceId: INSTANCE }),
    ).resolves.toEqual({ ok: false, reason: "other-server" });
    expect(pulled).toBeLessThan(WEBHOOK_PING_MAX_BYTES / 512 + 4);
  });

  it("이름을 찾지 못하면 이름 실패로 나눈다", async () => {
    for (const code of ["ENOTFOUND", "EAI_AGAIN"]) {
      await expect(
        checkWebhookAddress("https://new.example.ts.net:8443", {
          fetch: failing(nodeError(code)).fetch,
          instanceId: INSTANCE,
        }),
      ).resolves.toEqual({ ok: false, reason: "name-not-found" });
    }
  });

  it("연결 거부·끊김·시간 초과는 닿지 못함으로 나눈다", async () => {
    for (const error of [
      nodeError("ECONNREFUSED"),
      nodeError("ECONNRESET"),
      nodeError("UND_ERR_CONNECT_TIMEOUT"),
      new DOMException("timed out", "TimeoutError"),
    ]) {
      await expect(
        checkWebhookAddress("https://hooks.example.com", {
          fetch: failing(error).fetch,
          instanceId: INSTANCE,
        }),
      ).resolves.toEqual({ ok: false, reason: "unreachable" });
    }
  });

  it("답이 없으면 시간 제한 뒤에 닿지 못함으로 끝낸다", async () => {
    const silent: PingFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    await expect(
      checkWebhookAddress("https://hooks.example.com", {
        fetch: silent,
        instanceId: INSTANCE,
        timeoutMs: 20,
      }),
    ).resolves.toEqual({ ok: false, reason: "unreachable" });
  });

  it("인증서 오류 같은 그 밖의 실패는 따로 나눈다", async () => {
    await expect(
      checkWebhookAddress("https://hooks.example.com", {
        fetch: failing(nodeError("CERT_HAS_EXPIRED")).fetch,
        instanceId: INSTANCE,
      }),
    ).resolves.toEqual({ ok: false, reason: "check-failed" });
    await expect(
      checkWebhookAddress("https://hooks.example.com", {
        fetch: failing("boom").fetch,
        instanceId: INSTANCE,
      }),
    ).resolves.toEqual({ ok: false, reason: "check-failed" });
  });
});

describe("확인 요청이 내부 주소로 가지 않게 막기", () => {
  it.each([
    "http://hooks.example.com",
    "https://127.0.0.1:3000",
    "https://10.0.0.5",
    "https://100.100.1.2",
    "https://[::1]:3000",
    "https://localhost:3000",
    "https://app.localhost",
    "https://printer.local",
    "https://metadata.google.internal",
    "https://intranet",
    "https://user:pass@hooks.example.com",
    "https://hooks.example.com/api/webhooks/",
    "https://hooks.example.com/?next=http://127.0.0.1",
    "https://hooks.example.com/#x",
    "file:///etc/passwd",
    "not a url",
    "",
  ])("%s 은 묻지 않고 주소 형식 오류로 돌려준다", async (address) => {
    const fake = server(() => new Response("{}"));
    await expect(
      checkWebhookAddress(address, { fetch: fake.fetch, instanceId: INSTANCE }),
    ).resolves.toEqual({ ok: false, reason: "invalid-address" });
    expect(fake.sent).toEqual([]);
  });

  it("주소 끝의 / 와 대문자는 정리해 origin 하나로 둔다", () => {
    expect(parseWebhookAddress(" https://HOOKS.example.com/ ")).toBe("https://hooks.example.com");
    expect(parseWebhookAddress("https://hooks.example.com:443")).toBe("https://hooks.example.com");
  });
});

describe("확인 경로 답", () => {
  it("묻는 설치 ID 가 맞을 때만 200 으로 답하고, 설치 ID 를 담지 않는다", async () => {
    const yes = webhookPingAnswer(INSTANCE, INSTANCE);
    const no = webhookPingAnswer(INSTANCE, "guess");
    expect(yes.status).toBe(200);
    expect(no.status).toBe(404);
    expect(await yes.json()).toEqual({ product: "ganger", match: true });
    const text = await no.text();
    expect(text).not.toContain(INSTANCE);
  });

  it("thisServer 가짜는 같은 설치를 알아본다", async () => {
    await expect(
      checkWebhookAddress("https://hooks.example.com", {
        fetch: thisServer.fetch,
        instanceId: INSTANCE,
      }),
    ).resolves.toEqual({ ok: true, address: "https://hooks.example.com" });
  });
});

describe("Tailscale Funnel 명령", () => {
  it("8443 에 webhook 경로만 여는 명령을 이 서버 포트로 채운다", () => {
    expect(funnelCommand("tailscale", 3000)).toBe(
      "tailscale funnel --bg --https=8443 --set-path /api/webhooks/ http://127.0.0.1:3000/api/webhooks/",
    );
    expect(funnelAddress("server.example.ts.net")).toBe("https://server.example.ts.net:8443");
  });

  it("CLI 경로에 공백이 있으면 따옴표로 감싼다", () => {
    expect(funnelCommand("/Applications/My Tools/tailscale", 4000)).toBe(
      "'/Applications/My Tools/tailscale' funnel --bg --https=8443 --set-path /api/webhooks/ http://127.0.0.1:4000/api/webhooks/",
    );
  });
});

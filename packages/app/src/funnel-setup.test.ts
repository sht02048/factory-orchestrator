import { describe, expect, it } from "vitest";
import {
  funnelPrefillAddress,
  funnelTargetHost,
  parseServeStatus,
  planFunnel,
} from "./funnel-setup.js";
import type { FunnelPlanInput } from "./funnel-setup.js";

const HOST = "server.example.ts.net";
const IP = "100.64.0.10";
const WEBHOOK = "/api/webhooks/";

function input(over: Partial<FunnelPlanInput> = {}): FunnelPlanInput {
  return {
    cli: "tailscale",
    deviceHost: HOST,
    deviceAddresses: [HOST, IP, "[fd7a:115c:a1e0::1]"],
    bindHost: "127.0.0.1",
    webPort: 3000,
    serveOutput: "{}",
    ...over,
  };
}

const site = (port: number, handlers: Record<string, unknown>) => ({
  [`${HOST}:${String(port)}`]: { Handlers: handlers },
});

const fullStatus = JSON.stringify({
  TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true }, "10000": { TCPForward: "127.0.0.1:22" } },
  Web: {
    ...site(443, { "/": { Proxy: "http://127.0.0.1:3000" } }),
    ...site(8443, { "/docs/": { Proxy: "http://127.0.0.1:4000" } }),
  },
  AllowFunnel: { [`${HOST}:8443`]: true },
});

describe("Funnel 에 넘길 주소", () => {
  it.each([
    ["127.0.0.1", "127.0.0.1"],
    ["localhost", "127.0.0.1"],
    ["0.0.0.0", "127.0.0.1"],
    ["::", "127.0.0.1"],
    ["192.168.1.20", "192.168.1.20"],
    ["::1", "[::1]"],
  ])("WEB_HOST %s 는 %s 로 넘긴다", (bind, target) => {
    expect(funnelTargetHost(bind)).toBe(target);
  });

  it("다른 주소에 바인드하면 그 주소를 명령에 넣는다", () => {
    const plan = planFunnel(input({ bindHost: "192.168.1.20" }));
    expect(plan).toMatchObject({
      kind: "ready",
      command: `tailscale funnel --bg --https=8443 --set-path ${WEBHOOK} http://192.168.1.20:3000${WEBHOOK}`,
    });
  });

  it.each([IP, HOST, "SERVER.example.ts.net.", "fd7a:115c:a1e0::1"])(
    "WEB_HOST 가 이 기기의 tailnet 주소 %s 면 명령 대신 안내한다",
    (bindHost) => {
      const plan = planFunnel(input({ bindHost }));
      expect(plan.kind).toBe("bind-tailnet");
      expect(funnelPrefillAddress(plan)).toBeNull();
    },
  );
});

describe("Funnel 포트 고르기", () => {
  it("모두 비었으면 8443 을 쓴다", () => {
    expect(planFunnel(input())).toMatchObject({
      kind: "ready",
      port: 8443,
      portState: "free",
      address: `https://${HOST}:8443`,
    });
  });

  it("8443 이 차면 10000, 그것도 차면 443 을 쓰고 443 주소에는 포트를 붙이지 않는다", () => {
    const one = JSON.stringify({ TCP: { "8443": { HTTPS: true } } });
    expect(planFunnel(input({ serveOutput: one }))).toMatchObject({ port: 10000 });
    const two = JSON.stringify({ TCP: { "8443": { HTTPS: true }, "10000": { HTTPS: true } } });
    const plan = planFunnel(input({ serveOutput: two }));
    expect(plan).toMatchObject({ port: 443, address: `https://${HOST}` });
    expect(funnelPrefillAddress(plan)).toBe(`https://${HOST}`);
  });

  it("foreground 세션이 쓰는 포트도 찬 것으로 본다", () => {
    const status = JSON.stringify({
      Foreground: { session: { TCP: { "8443": { HTTPS: true } } } },
    });
    expect(planFunnel(input({ serveOutput: status }))).toMatchObject({ port: 10000 });
  });

  it("이 서버의 webhook 경로만 연 포트가 있으면 그 포트를 다시 쓴다", () => {
    const status = JSON.stringify({
      TCP: { "10000": { HTTPS: true } },
      Web: site(10000, { [WEBHOOK]: { Proxy: `http://127.0.0.1:3000${WEBHOOK}` } }),
      AllowFunnel: { [`${HOST}:10000`]: true },
    });
    expect(planFunnel(input({ serveOutput: status }))).toMatchObject({
      kind: "ready",
      port: 10000,
      portState: "ours",
    });
  });

  it("webhook 경로와 다른 경로를 함께 연 포트는 다시 쓰지 않는다", () => {
    const status = JSON.stringify({
      TCP: { "8443": { HTTPS: true } },
      Web: site(8443, {
        [WEBHOOK]: { Proxy: `http://127.0.0.1:3000${WEBHOOK}` },
        "/": { Proxy: "http://127.0.0.1:3000" },
      }),
    });
    expect(planFunnel(input({ serveOutput: status }))).toMatchObject({
      port: 10000,
      portState: "free",
    });
  });

  it("다 차면 무엇이 쓰는지와 포트별 명령을 내주고 미리 채우지 않는다", () => {
    const plan = planFunnel(input({ serveOutput: fullStatus }));
    if (plan.kind !== "ports-full") throw new Error(plan.kind);
    expect(plan.ports.map((port) => port.port)).toEqual([443, 8443, 10000]);
    expect(plan.ports[0]).toMatchObject({
      uses: ["/ → http://127.0.0.1:3000"],
      isPublic: false,
      address: `https://${HOST}`,
    });
    expect(plan.ports[1]).toMatchObject({
      uses: ["/docs/ → http://127.0.0.1:4000"],
      isPublic: true,
    });
    expect(plan.ports[2]?.uses).toEqual(["TCP → 127.0.0.1:22"]);
    expect(plan.ports[2]?.command).toContain("--https=10000");
    expect(funnelPrefillAddress(plan)).toBeNull();
  });

  it.each([undefined, "not json", "[1,2]", "null", JSON.stringify({ TCP: 7 })])(
    "이상한 출력 %s 은 모름으로 보고 8443 명령에 확인 안내를 붙인다",
    (serveOutput) => {
      expect(parseServeStatus(serveOutput)).toBeNull();
      expect(planFunnel(input({ serveOutput }))).toMatchObject({
        kind: "ready",
        port: 8443,
        portState: "unknown",
      });
    },
  );
});

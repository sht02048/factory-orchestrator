import { describe, expect, it } from "vitest";
import {
  allowedHosts,
  checkRequest,
  hostnameOfHostHeader,
  rejectionLogLine,
  rejectionResponse,
} from "./request-guard";
import type { AllowedHostsInput } from "./request-guard";

/*
 * Host·Origin 검사(0048). 가상 주소만 쓴다(example.com, example.ts.net).
 */

const configured: AllowedHostsInput = {
  bindHost: "127.0.0.1",
  webAddress: "https://server.example.ts.net",
  webhookAddress: "https://hooks.example.com",
};
const unset: AllowedHostsInput = { bindHost: "127.0.0.1", webAddress: null, webhookAddress: null };

function request(
  path: string,
  init: { method?: string; host?: string; origin?: string } = {},
): Request {
  const headers = new Headers();
  if (init.host !== undefined) headers.set("host", init.host);
  if (init.origin !== undefined) headers.set("origin", init.origin);
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: init.method ?? "GET",
    headers,
  });
}

function verdictOf(req: Request, input: AllowedHostsInput = configured) {
  return checkRequest(req, allowedHosts(input));
}

describe("Host 검사", () => {
  it("127.0.0.1·localhost·[::1] 은 주소를 정하지 않아도 늘 받는다", () => {
    for (const host of ["127.0.0.1:3000", "localhost:3000", "LOCALHOST", "[::1]:3000"]) {
      expect(verdictOf(request("/runs", { host }), unset)).toEqual({ ok: true });
    }
  });

  it("주소를 잘못 넣어도 127.0.0.1 은 막히지 않는다", () => {
    const wrong = {
      bindHost: "0.0.0.0",
      webAddress: "https://typo.example.com",
      webhookAddress: null,
    };
    expect(verdictOf(request("/settings", { host: "127.0.0.1:3000" }), wrong)).toEqual({
      ok: true,
    });
  });

  it("다른 기기에서 열 주소의 호스트는 포트가 달라도 받는다", () => {
    for (const host of [
      "server.example.ts.net",
      "server.example.ts.net:443",
      "Server.Example.ts.net.",
    ]) {
      expect(verdictOf(request("/runs", { host }))).toEqual({ ok: true });
    }
  });

  it("허용하지 않은 Host 는 403 host-not-allowed 로 거절한다(DNS 리바인딩)", () => {
    expect(verdictOf(request("/runs", { host: "evil.example:3000" }))).toEqual({
      ok: false,
      status: 403,
      reason: "host-not-allowed",
      host: "evil.example:3000",
      origin: null,
    });
  });

  it("바깥 주소를 정하지 않았으면 tailnet 이름으로 온 화면 요청을 거절한다", () => {
    const verdict = verdictOf(request("/runs", { host: "server.example.ts.net" }), unset);
    expect(verdict).toMatchObject({ ok: false, reason: "host-not-allowed" });
  });

  it("바인드 주소가 특정 주소면 그 주소로 온 요청을 받고, 와일드카드는 받지 않는다", () => {
    const tailnetIp = { ...unset, bindHost: "100.64.0.1" };
    expect(verdictOf(request("/runs", { host: "100.64.0.1:3000" }), tailnetIp)).toEqual({
      ok: true,
    });
    const wildcard = { ...unset, bindHost: "0.0.0.0" };
    expect(verdictOf(request("/runs", { host: "0.0.0.0:3000" }), wildcard)).toMatchObject({
      ok: false,
      reason: "host-not-allowed",
    });
  });

  it("Host 헤더에 사용자 정보·경로를 섞으면 받지 않는다", () => {
    expect(hostnameOfHostHeader("evil.example@127.0.0.1")).toBeNull();
    expect(hostnameOfHostHeader("127.0.0.1/x")).toBeNull();
    expect(hostnameOfHostHeader("")).toBeNull();
    expect(verdictOf(request("/runs", { host: "evil.example@127.0.0.1" }))).toMatchObject({
      ok: false,
      reason: "host-not-allowed",
    });
  });

  it("webhook 공개 주소의 호스트는 webhook 경로에서만 받는다", () => {
    const webhook = request("/api/webhooks/tracker/c-1", {
      method: "POST",
      host: "hooks.example.com",
    });
    expect(verdictOf(webhook)).toEqual({ ok: true });
    expect(verdictOf(request("/runs", { host: "hooks.example.com" }))).toMatchObject({
      ok: false,
      reason: "host-not-allowed",
    });
  });

  it("신원 확인 경로는 Host 를 보지 않는다", () => {
    expect(verdictOf(request("/api/identity", { host: "server.example.ts.net" }), unset)).toEqual({
      ok: true,
    });
    // 상태를 바꾸는 요청은 예외가 아니다
    expect(
      verdictOf(request("/api/identity", { method: "POST", host: "evil.example" }), unset),
    ).toMatchObject({ ok: false, reason: "host-not-allowed" });
  });
});

describe("Origin 검사", () => {
  const serverFn = "/_serverFn/abc";

  it("허용한 Origin 의 POST(server function)는 통과한다", () => {
    for (const origin of ["http://127.0.0.1:3000", "https://server.example.ts.net"]) {
      expect(
        verdictOf(request(serverFn, { method: "POST", host: "127.0.0.1:3000", origin })),
      ).toEqual({ ok: true });
    }
  });

  it("다른 사이트의 Origin 으로 온 POST 는 403 origin-not-allowed 로 거절한다", () => {
    expect(
      verdictOf(
        request(serverFn, {
          method: "POST",
          host: "127.0.0.1:3000",
          origin: "https://evil.example",
        }),
      ),
    ).toEqual({
      ok: false,
      status: 403,
      reason: "origin-not-allowed",
      host: "127.0.0.1:3000",
      origin: "https://evil.example",
    });
  });

  it("null Origin 과 http·https 가 아닌 Origin 은 거절한다", () => {
    for (const origin of ["null", "file://", "chrome-extension://abc"]) {
      expect(
        verdictOf(request(serverFn, { method: "POST", host: "127.0.0.1", origin })),
      ).toMatchObject({ ok: false, reason: "origin-not-allowed" });
    }
  });

  it("webhook 공개 주소는 화면의 Origin 으로 받지 않는다", () => {
    expect(
      verdictOf(
        request(serverFn, {
          method: "POST",
          host: "127.0.0.1",
          origin: "https://hooks.example.com",
        }),
      ),
    ).toMatchObject({ ok: false, reason: "origin-not-allowed" });
  });

  it("Origin 이 없는 POST 는 브라우저가 아닌 클라이언트라 받는다", () => {
    expect(verdictOf(request(serverFn, { method: "POST", host: "127.0.0.1" }))).toEqual({
      ok: true,
    });
  });

  it("GET 은 Origin 을 보지 않는다", () => {
    expect(
      verdictOf(request("/runs", { host: "127.0.0.1", origin: "https://evil.example" })),
    ).toEqual({ ok: true });
  });

  it("webhook 은 Origin 없이도, 어떤 Origin 이어도 통과한다(서명으로 검증)", () => {
    const path = "/api/webhooks/tracker/c-1";
    expect(verdictOf(request(path, { method: "POST", host: "hooks.example.com" }))).toEqual({
      ok: true,
    });
    expect(
      verdictOf(
        request(path, { method: "POST", host: "127.0.0.1", origin: "https://linear.example" }),
      ),
    ).toEqual({ ok: true });
  });
});

describe("거절 응답과 로그", () => {
  it("403 과 까닭을 글로 돌려주고, 로그에 상태 코드·까닭·경로·Host 를 남긴다", async () => {
    const req = request("/runs", { host: "evil.example:3000" });
    const verdict = verdictOf(req);
    if (verdict.ok) throw new Error("expected rejection");
    const response = rejectionResponse(verdict.reason);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("does not accept the host name");
    expect(rejectionLogLine(req, verdict)).toBe(
      'request rejected: 403 host-not-allowed GET "/runs" host="evil.example:3000" origin=-',
    );
  });
});

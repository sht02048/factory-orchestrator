import { silentLogger } from "@ganger/log/testing";
import { readFileSync } from "node:fs";
import { AdapterRegistry, toTrackerConnectionId } from "@ganger/core";
import { SecretBox, migrate, openDatabase, saveTrackerConnection } from "@ganger/db";
import { allowedHosts, checkRequest, rejectionResponse } from "@ganger/app/request-guard";
import { LINEAR_TRACKER_KIND, linearTrackerFactory } from "@ganger/tracker-linear";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { receiveTrackerWebhook } from "../webhooks/receive";
import type { WebhookContext } from "../webhooks/receive";
import { serveRequest } from "./serve-request";

const FIXTURE_DIR = new URL("../../../../docs/research/fixtures/0005/", import.meta.url);
const SIGNING_SECRET = "fixture-signing-secret";
const connection = toTrackerConnectionId("conn-acme");
const allowed = allowedHosts({
  bindHost: "127.0.0.1",
  webAddress: "https://server.example.ts.net",
  webhookAddress: "https://hooks.example.com",
});

function guard(request: Request): Response | null {
  const verdict = checkRequest(request, allowed);
  return verdict.ok ? null : rejectionResponse(verdict.reason);
}

function request(
  path: string,
  init: { method?: string; host?: string; origin?: string; body?: BodyInit } = {},
): Request {
  const headers = new Headers({ host: init.host ?? "127.0.0.1:3000" });
  if (init.origin !== undefined) headers.set("origin", init.origin);
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}

async function serve(req: Request, handle: (request: Request) => Response | Promise<Response>) {
  let wakes = 0;
  let handled = 0;
  const response = await serveRequest(req, {
    guard,
    handle: (guarded) => {
      handled += 1;
      return handle(guarded);
    },
    wakeWorker: () => (wakes += 1),
  });
  return { status: response.status, handled, wakes };
}

const respondWith = (status: number) => () => new Response(null, { status });

describe("web 서버 진입의 worker 깨우기", () => {
  it("2xx 로 응답한 POST 요청(server function)에만 신호를 보낸다", async () => {
    expect(
      await serve(
        request("/_serverFn/assign", { method: "POST", origin: "http://127.0.0.1:3000" }),
        respondWith(200),
      ),
    ).toEqual({ status: 200, handled: 1, wakes: 1 });
    expect(await serve(request("/_serverFn/runs"), respondWith(200))).toEqual({
      status: 200,
      handled: 1,
      wakes: 0,
    });
  });

  it("2xx 가 아닌 POST 응답에는 신호를 보내지 않는다", async () => {
    for (const status of [302, 400, 404, 500]) {
      expect(
        await serve(request("/_serverFn/assign", { method: "POST" }), respondWith(status)),
      ).toEqual({ status, handled: 1, wakes: 0 });
    }
  });

  it("처리 중에 예외가 나면 신호 없이 예외를 그대로 넘긴다", async () => {
    let wakes = 0;
    await expect(
      serveRequest(request("/_serverFn/assign", { method: "POST" }), {
        guard,
        handle: () => Promise.reject(new Error("boom")),
        wakeWorker: () => (wakes += 1),
      }),
    ).rejects.toThrow("boom");
    expect(wakes).toBe(0);
  });

  it("Host·Origin 검사에서 거절한 POST 는 처리하지 않고 신호도 보내지 않는다", async () => {
    expect(
      await serve(
        request("/_serverFn/assign", { method: "POST", host: "evil.example.com" }),
        respondWith(200),
      ),
    ).toEqual({ status: 403, handled: 0, wakes: 0 });
    expect(
      await serve(
        request("/_serverFn/assign", { method: "POST", origin: "https://evil.example.com" }),
        respondWith(200),
      ),
    ).toEqual({ status: 403, handled: 0, wakes: 0 });
  });

  it("서명이 맞는 webhook 은 신호를 보내고, 서명이 틀린 webhook 은 보내지 않는다", async () => {
    const context = webhookContext();
    const { rawBody, headers } = fixture("issue-update-label-added");
    const receivedAt = new Date(Number(headers["linear-timestamp"]) + 500);
    const webhook = (body: Uint8Array<ArrayBuffer>) => {
      const req = new Request(`http://hooks.example.com/api/webhooks/tracker/${connection}`, {
        method: "POST",
        headers: { ...headers, host: "hooks.example.com" },
        body,
      });
      return serve(req, (guarded) =>
        receiveTrackerWebhook(context, connection, guarded, receivedAt),
      );
    };

    const tampered = new Uint8Array(rawBody);
    tampered[tampered.length - 2] = 0x20;
    expect(await webhook(tampered)).toEqual({ status: 401, handled: 1, wakes: 0 });
    expect(await webhook(rawBody)).toEqual({ status: 200, handled: 1, wakes: 1 });
  });
});

const headersSchema = z.record(z.string(), z.string());

function fixture(name: string): {
  rawBody: Uint8Array<ArrayBuffer>;
  headers: Record<string, string>;
} {
  return {
    rawBody: new Uint8Array(readFileSync(new URL(`${name}.json`, FIXTURE_DIR))),
    headers: headersSchema.parse(
      JSON.parse(readFileSync(new URL(`${name}.headers.json`, FIXTURE_DIR), "utf8")),
    ),
  };
}

function webhookContext(): WebhookContext {
  const db = openDatabase(":memory:");
  migrate(db);
  const secretBox = new SecretBox(new Uint8Array(32).fill(7));
  saveTrackerConnection(db, secretBox, {
    id: connection,
    kind: LINEAR_TRACKER_KIND,
    name: "Acme",
    config: {},
    secrets: { apiKey: "lin_api_example", webhookSecret: SIGNING_SECRET },
  });
  return {
    db,
    secretBox,
    registry: new AdapterRegistry().registerTracker(linearTrackerFactory),
    logger: silentLogger,
  };
}

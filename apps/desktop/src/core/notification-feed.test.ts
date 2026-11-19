import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { NotificationRecord } from "@ganger/app/notifications/feed";
import { afterEach, describe, expect, it } from "vitest";
import { NotificationFeed, SseParser } from "./notification-feed.js";
import type { FeedBatch, FeedTransport } from "./notification-feed.js";

function record(id: number, seq: number, resolved = false): NotificationRecord {
  return {
    id,
    seq,
    kind: "question",
    target: { kind: "run", runId: `run-${id}`, workspaceId: "ws-1", ticketKey: `ACME-${id}` },
    subject: `ACME-${id}`,
    detail: null,
    createdAt: "2026-11-19T09:00:00.000Z",
    resolvedAt: resolved ? "2026-11-19T09:05:00.000Z" : null,
  };
}

class FakeServer {
  log: NotificationRecord[] = [];
  streamAvailable = true;
  readonly streamRequests: Array<string | null> = [];
  readonly pollRequests: Array<string | null> = [];
  private readonly clients = new Set<ServerResponse>();
  private server: Server | undefined;
  origin = "";

  async listen(): Promise<void> {
    this.server = createServer((request, response) => this.handle(request, response));
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    if (address === null || typeof address === "string") throw new Error("no TCP address");
    this.origin = `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    this.dropClients();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  add(next: NotificationRecord): void {
    this.log.push(next);
    for (const client of this.clients) client.write(this.message(next));
  }

  dropClients(): void {
    for (const client of this.clients) client.destroy();
    this.clients.clear();
  }

  private cursor(): number {
    return Math.max(0, ...this.log.map((entry) => entry.seq));
  }

  private open(): number[] {
    const latest = new Map<number, NotificationRecord>();
    for (const entry of this.log) latest.set(entry.id, entry);
    return [...latest.values()]
      .filter((entry) => entry.resolvedAt === null)
      .map((entry) => entry.id);
  }

  private after(value: string | null): NotificationRecord[] {
    if (value === null) {
      const open = new Set(this.open());
      const latest = new Map<number, NotificationRecord>();
      for (const entry of this.log) latest.set(entry.id, entry);
      return [...latest.values()].filter((entry) => open.has(entry.id));
    }
    return this.log.filter((entry) => entry.seq > Number(value));
  }

  private message(entry: NotificationRecord): string {
    return `event: notification\nid: ${entry.seq}\ndata: ${JSON.stringify(entry)}\n\n`;
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", this.origin);
    if (url.pathname === "/api/notification-events/stream") {
      const header = request.headers["last-event-id"];
      const lastId = typeof header === "string" ? header : null;
      this.streamRequests.push(lastId);
      if (!this.streamAvailable) {
        response.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      for (const entry of this.after(lastId)) response.write(this.message(entry));
      response.write(
        `event: ready\nid: ${this.cursor()}\ndata: ${JSON.stringify({ cursor: this.cursor(), open: this.open() })}\n\n`,
      );
      this.clients.add(response);
      request.on("close", () => this.clients.delete(response));
      return;
    }
    if (url.pathname === "/api/notification-events") {
      const after = url.searchParams.get("after");
      this.pollRequests.push(after);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ events: this.after(after), cursor: this.cursor(), open: this.open() }),
      );
      return;
    }
    response.writeHead(404).end();
  }
}

const servers: FakeServer[] = [];
const feeds: NotificationFeed[] = [];

afterEach(async () => {
  for (const feed of feeds.splice(0)) feed.stop();
  for (const server of servers.splice(0)) await server.close();
});

async function startServer(): Promise<FakeServer> {
  const server = new FakeServer();
  await server.listen();
  servers.push(server);
  return server;
}

function startFeed(server: FakeServer, overrides: { streamRetryMs?: number } = {}) {
  const batches: FeedBatch[] = [];
  const transports: FeedTransport[] = [];
  const feed = new NotificationFeed({
    origin: server.origin,
    onBatch: (batch) => batches.push(batch),
    onTransport: (transport) => transports.push(transport),
    pollMs: 20,
    reconnectMs: 10,
    maxReconnectMs: 20,
    streamRetryMs: overrides.streamRetryMs ?? 60_000,
  });
  feeds.push(feed);
  feed.start();
  return { feed, batches, transports };
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const ids = (batches: ReadonlyArray<FeedBatch>) =>
  batches.flatMap((batch) => batch.events.map((event) => [event.id, event.seq]));

describe("SSE 파서", () => {
  it("여러 조각으로 나뉜 메시지와 주석, CRLF 를 읽는다", () => {
    const parser = new SseParser();
    expect(parser.push(": ping\n\nevent: rea")).toEqual([]);
    expect(parser.push('dy\r\nid: 4\r\ndata: {"a":1}\r\n\r\n')).toEqual([
      { event: "ready", id: "4", data: '{"a":1}' },
    ]);
  });
});

describe("알림 사건 받기", () => {
  it("SSE 로 연결하면 열린 사건을 첫 묶음으로, 새 사건은 바로 받는다", async () => {
    const server = await startServer();
    server.add(record(1, 1));
    const { batches, transports } = startFeed(server);
    await waitFor(() => batches.length === 1);
    expect(batches[0]).toMatchObject({ initial: true, open: [1] });
    expect(ids(batches)).toEqual([[1, 1]]);
    server.add(record(2, 2));
    await waitFor(() => batches.length === 2);
    expect(batches[1]).toMatchObject({ initial: false, open: null });
    expect(ids(batches.slice(1))).toEqual([[2, 2]]);
    expect(transports).toEqual(["stream"]);
  });

  it("끊기면 다시 붙으며 Last-Event-ID 로 마지막 번호 뒤만 받는다", async () => {
    const server = await startServer();
    server.add(record(1, 1));
    const { batches } = startFeed(server);
    await waitFor(() => batches.length === 1);
    server.add(record(2, 2));
    await waitFor(() => batches.length === 2);
    server.dropClients();
    server.add(record(1, 3, true));
    server.add(record(3, 4));
    await waitFor(() => batches.length === 3);
    expect(server.streamRequests).toEqual([null, "2"]);
    expect(batches[2]).toMatchObject({ initial: true, open: [2, 3] });
    expect(ids(batches.slice(2))).toEqual([
      [1, 3],
      [3, 4],
    ]);
  });

  it("SSE 가 안 되면 같은 저장소를 읽는 폴링으로 같은 사건을 받는다", async () => {
    const server = await startServer();
    server.streamAvailable = false;
    server.add(record(1, 1));
    const { batches, transports } = startFeed(server);
    await waitFor(() => batches.length >= 1);
    expect(batches[0]).toMatchObject({ initial: true, open: [1] });
    expect(ids(batches.slice(0, 1))).toEqual([[1, 1]]);
    server.add(record(2, 2));
    await waitFor(() => ids(batches).some(([id]) => id === 2));
    expect(server.pollRequests[0]).toBeNull();
    expect(server.pollRequests).toContain("1");
    expect(transports).toContain("polling");
    expect(batches.filter((batch) => batch.initial)).toHaveLength(1);
  });

  it("폴링하다가 SSE 가 돌아오면 다시 SSE 로 받는다", async () => {
    const server = await startServer();
    server.streamAvailable = false;
    const { batches, transports } = startFeed(server, { streamRetryMs: 50 });
    await waitFor(() => transports.includes("polling"));
    server.streamAvailable = true;
    await waitFor(() => transports.at(-1) === "stream");
    server.add(record(5, 5));
    await waitFor(() => ids(batches).some(([id]) => id === 5));
    expect(server.streamRequests.at(-1)).toBe("0");
  });
});

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { checkSchema, loadMigrations, migrate, openDatabase } from "@ganger/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { homePaths } from "../home.js";
import type { AppLayout } from "../layout.js";
import { runProgram } from "../program.js";
import type { ProgramContext } from "../program.js";
import { KEY, seedMcpDatabase } from "./test-seed.js";

let home: string;
let databasePath: string;
let err: string[];
let out: string[];

const unusedLayout: AppLayout = {
  web: () => {
    throw new Error("not used");
  },
  worker: () => {
    throw new Error("not used");
  },
};

function context(stdin: PassThrough, stdout: PassThrough): ProgramContext {
  return {
    env: {},
    platform: "darwin",
    userHome: home,
    uid: 501,
    nodePath: "/opt/node/bin/node",
    cliEntry: "/opt/ganger/dist/bin/cli.js",
    layout: unusedLayout,
    runCommand: () => ({ ok: true }),
    holdSleepAssertion: () => ({ exited: new Promise(() => undefined), release: () => undefined }),
    version: "0.0.0-test",
    stdin,
    stdout,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    onStopSignal: () => undefined,
  };
}

function writeEnv(): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(
    homePaths(home).envFile,
    `DATABASE_PATH=${databasePath}\nENCRYPTION_KEY=${Buffer.from(KEY).toString("base64")}\n`,
  );
}

function runMcp(stdin = new PassThrough(), stdout = new PassThrough()): Promise<number> {
  return runProgram(["mcp", "--home", home], context(stdin, stdout));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ganger-mcp-program-"));
  databasePath = join(home, "data", "ganger.db");
  err = [];
  out = [];
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const response = z.object({ id: z.number(), result: z.record(z.string(), z.unknown()) });

describe("ganger mcp", () => {
  it("DB가 없으면 서버를 먼저 켜라고 알리고, DB를 만들지 않는다", async () => {
    writeEnv();
    expect(await runMcp()).toBe(1);
    expect(err.join("\n")).toContain("Start the server first");
    expect(existsSync(databasePath)).toBe(false);
  });

  it("DB가 뒤처졌으면 서버를 먼저 켜라고 알리고, 마이그레이션을 돌리지 않는다", async () => {
    writeEnv();
    const all = loadMigrations();
    const db = openDatabase(databasePath);
    migrate(db, all.slice(0, -1));
    db.$client.close();

    expect(await runMcp()).toBe(1);
    expect(err.join("\n")).toContain("Start the server first");
    expect(err.join("\n")).toContain(all.at(-1)?.name);

    const after = openDatabase(databasePath);
    expect(checkSchema(after, all)).toEqual({ kind: "behind", missing: [all.at(-1)?.name] });
    after.$client.close();
  });

  it("DB가 앞섰으면 Ganger를 업데이트하라고 알린다", async () => {
    writeEnv();
    const db = openDatabase(databasePath);
    migrate(db);
    db.$client
      .prepare(
        "INSERT INTO schema_migrations (name, hash, applied_at) VALUES ('99990101000000_future', 'x', 0)",
      )
      .run();
    db.$client.close();

    expect(await runMcp()).toBe(1);
    expect(err.join("\n")).toContain("Update Ganger");
  });

  it("판이 같으면 stdin·stdout으로 MCP를 주고받고, stdin이 닫히면 끝난다", async () => {
    writeEnv();
    seedMcpDatabase(databasePath).db.$client.close();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const lines: string[] = [];
    let buffered = "";
    stdout.on("data", (chunk: Buffer) => {
      buffered += chunk.toString();
      const parts = buffered.split("\n");
      buffered = parts.pop() ?? "";
      lines.push(...parts);
    });
    const running = runMcp(stdin, stdout);
    const send = (message: Record<string, unknown>) =>
      stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    const reply = async (id: number) => {
      for (;;) {
        const line = lines.find((l) => response.safeParse(JSON.parse(l)).data?.id === id);
        if (line !== undefined) return response.parse(JSON.parse(line)).result;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };

    send({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    });
    expect(await reply(1)).toMatchObject({ serverInfo: { name: "ganger", version: "0.0.0-test" } });
    send({ method: "notifications/initialized" });
    send({ id: 2, method: "tools/call", params: { name: "get_dashboard", arguments: {} } });
    expect(JSON.stringify(await reply(2))).toContain("Acme Commerce");

    stdin.end();
    expect(await running).toBe(0);
    expect(out).toEqual([]);
  });
});

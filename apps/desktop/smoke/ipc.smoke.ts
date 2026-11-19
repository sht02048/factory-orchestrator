import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nodeEnv } from "./helpers.js";

const DESKTOP = resolve(import.meta.dirname, "..");
const ELECTRON =
  process.env["SMOKE_ELECTRON"] ??
  join(
    DESKTOP,
    "node_modules",
    "electron",
    "dist",
    "Electron.app",
    "Contents",
    "MacOS",
    "Electron",
  );

const PARENT = `
import { spawn } from "node:child_process";
const [webScript, workerScript] = process.argv.slice(2);
const options = { env: process.env, stdio: ["ignore", "pipe", "pipe", "ipc"] };
const web = spawn(process.execPath, [webScript], options);
const worker = spawn(process.execPath, [workerScript], options);
const timeout = setTimeout(() => finish({ error: "timed out" }), 20_000);
function finish(result) {
  clearTimeout(timeout);
  console.log(JSON.stringify(result));
  web.kill("SIGTERM");
  worker.kill("SIGTERM");
  process.exit(0);
}
web.on("message", (message) => {
  if (worker.connected) worker.send(message, () => undefined);
});
worker.on("message", (message) => finish({ execPath: process.execPath, received: message }));
`;

const WEB = `
process.send({ type: "wake" }, () => undefined);
setInterval(() => undefined, 1000);
`;

const WORKER = `
process.on("message", (message) => process.send({ worker: process.execPath, message }));
`;

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ganger-desktop-ipc-"));
});

afterAll(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

describe("Electron 을 Node 로 돌릴 때의 IPC", () => {
  it("ELECTRON_RUN_AS_NODE=1 인 Electron 이 IPC 통로로 띄운 자식끼리 메시지를 중계한다", () => {
    const script = (name: string, source: string): string => {
      const file = join(dir, `${name}.mjs`);
      writeFileSync(file, source);
      return file;
    };
    const result = spawnSync(
      ELECTRON,
      [script("parent", PARENT), script("web", WEB), script("worker", WORKER)],
      { env: nodeEnv(), encoding: "utf8", timeout: 60_000 },
    );

    expect({ status: result.status, stderr: result.stderr }).toMatchObject({ status: 0 });
    const electron = realpathSync(ELECTRON);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      execPath: electron,
      received: { worker: electron, message: { type: "wake" } },
    });
  });
});

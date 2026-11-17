/*
 * 빌드한 CLI로 init과 start를 실제로 돌려 본다. start가 DB 마이그레이션을 돌리고, 빌드한 web이 바인딩 주소에서
 * Runs 화면을 200으로 주고, 빌드한 worker가 뜨고, SIGTERM을 받으면 둘을 멈추고 끝나는지 본다.
 * vitest의 start 시험은 web·worker 자리에 작은 스크립트를 넣는다. CI는 test 뒤에 build하므로 실제 산출물은 여기서 본다.
 *
 * 실행: pnpm build 뒤에 node scripts/smoke-cli.ts
 * 임시 폴더를 home으로 쓰고 끝나면 치운다. 서비스 등록은 하지 않는다.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const CLI = join(import.meta.dirname, "..", "apps", "cli", "dist", "bin", "cli.js");
const STARTUP_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 20_000;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${what} within ${timeoutMs} ms`);
}

const home = mkdtempSync(join(tmpdir(), "factory-smoke-cli-"));
const port = await freePort();
// 셸에 부팅 값이 남아 있으면 .env를 덮으므로 빼고 돌린다.
const env = { ...process.env };
for (const name of ["WEB_HOST", "WEB_PORT", "DATABASE_PATH", "ENCRYPTION_KEY", "FACTORY_HOME"]) {
  delete env[name];
}

let output = "";
let failure: string | undefined;
let exitCode: number | null | undefined;
let child: ReturnType<typeof spawn> | undefined;
try {
  const init = spawnSync(process.execPath, [CLI, "init", "--home", home, "--port", String(port)], {
    env,
    encoding: "utf8",
  });
  output += init.stdout + init.stderr;
  if (init.status !== 0) throw new Error(`init exited with ${init.status}`);

  const started = spawn(process.execPath, [CLI, "start", "--home", home], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = started;
  started.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  started.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  started.once("exit", (code) => (exitCode = code));

  await waitFor(
    () => {
      if (exitCode !== undefined)
        throw new Error(`start exited with ${exitCode} before web was ready`);
      return output.includes("Web is listening at");
    },
    STARTUP_TIMEOUT_MS,
    "start did not report that web is listening",
  );
  await waitFor(
    () => output.includes("[worker] started"),
    STARTUP_TIMEOUT_MS,
    "worker did not start",
  );

  const response = await fetch(`http://127.0.0.1:${port}/runs`);
  if (response.status !== 200) throw new Error(`GET /runs returned ${response.status}`);
  console.log(`GET /runs -> ${response.status}`);

  const db = new DatabaseSync(join(home, "data", "factory-orchestrator.db"), { readOnly: true });
  const applied = db.prepare("SELECT count(*) AS n FROM schema_migrations").get()?.["n"];
  db.close();
  if (typeof applied !== "number" || applied === 0) throw new Error("no migrations were applied");
  console.log(`schema_migrations: ${applied} row(s)`);

  started.kill("SIGTERM");
  await waitFor(() => exitCode !== undefined, STOP_TIMEOUT_MS, "start did not stop after SIGTERM");
  if (exitCode !== 0) throw new Error(`start exited with ${exitCode} after SIGTERM`);
  try {
    await fetch(`http://127.0.0.1:${port}/runs`);
    throw new Error("web still responds after start stopped");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("web still")) throw error;
  }
  console.log("start stopped web and worker on SIGTERM");
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  if (child !== undefined && exitCode === undefined) child.kill("SIGKILL");
  rmSync(home, { recursive: true, force: true });
}

if (failure !== undefined) {
  console.error(`cli smoke test failed: ${failure}\n--- output ---\n${output}`);
  process.exitCode = 1;
}

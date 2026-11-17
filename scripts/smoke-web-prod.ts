/*
 * web 프로덕션 빌드를 실제로 띄워 Runs 화면이 200으로 오는지 보는 짧은 시험.
 * 개발 서버에서는 되고 번들한 산출물에서만 깨지는 문제(예: 마이그레이션 SQL이 산출물에 빠짐)를 CI에서 잡는다.
 *
 * 실행: pnpm build 뒤에 node scripts/smoke-web-prod.ts
 * 임시 폴더의 새 SQLite 파일과 임의 암호화 키로 `pnpm --filter @factory/web start`를 띄우고, 끝나면 치운다.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STARTUP_TIMEOUT_MS = 30_000;

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

async function waitForServer(url: string, exited: () => boolean): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited()) throw new Error("web server exited before it started listening");
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`web server did not start within ${STARTUP_TIMEOUT_MS} ms`);
}

const dir = mkdtempSync(join(tmpdir(), "factory-smoke-"));
const port = await freePort();
let output = "";
let hasExited = false;
const server = spawn("pnpm", ["--filter", "@factory/web", "start"], {
  // pnpm과 srvx를 함께 끝낼 수 있게 프로세스 그룹을 따로 둔다.
  detached: true,
  env: {
    ...process.env,
    WEB_HOST: "127.0.0.1",
    WEB_PORT: String(port),
    DATABASE_PATH: join(dir, "factory.db"),
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
server.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
server.once("exit", () => (hasExited = true));

let failure: string | undefined;
try {
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base, () => hasExited);
  const response = await fetch(`${base}/runs`);
  const body = await response.text();
  if (response.status !== 200) {
    // 서버 렌더 오류는 로그에 남지 않고 응답 HTML 안에만 실린다. 오류 문장만 골라 보인다.
    const errors = body.match(/\b(?:[A-Z]\w*Error|ENOENT)\b[^"<]{0,300}/g) ?? [body.slice(0, 2000)];
    failure = `GET /runs returned ${response.status}\n${[...new Set(errors)].join("\n")}`;
  } else {
    console.log(`GET /runs -> ${response.status}`);
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  if (!hasExited && server.pid !== undefined) process.kill(-server.pid, "SIGKILL");
  rmSync(dir, { recursive: true, force: true });
}

if (failure !== undefined) {
  console.error(`web production smoke test failed: ${failure}\n--- server output ---\n${output}`);
  process.exitCode = 1;
}

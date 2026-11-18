/*
 * 빌드한 CLI로 init과 start를 실제로 돌려 본다. start가 DB 마이그레이션을 돌리고, 빌드한 web이 바인딩 주소에서
 * Runs 화면을 200으로 주고, 빌드한 worker가 뜨고, 실제 어댑터(Orca 러너)로 러너 상태를 확인해 DB에 기록하고,
 * SIGTERM을 받으면 둘을 멈추고 끝나는지 본다. 러너는 닿지 않는 ssh 대상이라 Offline으로 기록된다.
 * vitest의 start 시험은 web·worker 자리에 작은 스크립트를 넣는다. CI는 test 뒤에 build하므로 실제 산출물은 여기서 본다.
 *
 * 실행:
 *   pnpm build 뒤에 node scripts/smoke-cli.ts
 *     저장소에서 빌드한 CLI(apps/cli/dist)를 돌린다.
 *   pnpm build && pnpm run bundle 뒤에 node scripts/smoke-cli.ts --bundle [<tarball>]
 *     서버 배포물 tarball(기본: dist/factory-orchestrator-<version>.tar.gz)을 저장소 밖 새 임시 폴더에 풀고,
 *     정적 검사(scripts/bundle-check.ts) 뒤 그 안의 CLI를 그 폴더에서 돌린다(0029).
 *   --node <실행 파일>을 주면 CLI를 그 실행 파일로 돌린다. web·worker도 같은 실행 파일로 뜬다. 예를 들어
 *     ELECTRON_RUN_AS_NODE=1과 함께 Electron 실행 파일을 주면 데스크톱 앱(0046)의 Node로 띄워 본다.
 *
 * 임시 폴더를 home·설치 폴더로 쓰고 끝나면 치운다. 서비스 등록은 하지 않는다.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { findBundleProblems } from "./bundle-check.ts";

const REPO = join(import.meta.dirname, "..");
const STARTUP_TIMEOUT_MS = 60_000;
/** worker는 10초마다 돈다. ssh 연결 제한 시간(아래 러너 설정)까지 더해 넉넉히 기다린다 */
const RUNNER_CHECK_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 20_000;

const { values, positionals } = parseArgs({
  options: { bundle: { type: "boolean", default: false }, node: { type: "string" } },
  allowPositionals: true,
});
const nodePath = values.node === undefined ? process.execPath : resolve(values.node);

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

function defaultTarball(): string {
  const parsed: unknown = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  const version =
    typeof parsed === "object" && parsed !== null && "version" in parsed ? parsed.version : null;
  if (typeof version !== "string") throw new Error("package.json has no version");
  return join(REPO, "dist", `factory-orchestrator-${version}.tar.gz`);
}

/** 배포물을 새 임시 폴더에 풀고 그 안의 CLI 경로를 돌려준다 */
function installBundle(installDir: string): string {
  const tarball = resolve(positionals[0] ?? defaultTarball());
  const untar = spawnSync("tar", ["-xzf", tarball, "-C", installDir], { encoding: "utf8" });
  if (untar.status !== 0) throw new Error(`could not extract ${tarball}: ${untar.stderr}`);
  const root = join(installDir, tarball.replace(/^.*[\\/]/, "").replace(/\.tar\.gz$/, ""));
  const problems = findBundleProblems(root);
  if (problems.length > 0) throw new Error(`server bundle check failed:\n${problems.join("\n")}`);
  console.log(`extracted ${tarball} to ${root}; bundle check passed`);
  return join(root, "cli", "bin", "cli.js");
}

const home = mkdtempSync(join(tmpdir(), "factory-smoke-cli-"));
const installDir = values.bundle ? mkdtempSync(join(tmpdir(), "factory-smoke-bundle-")) : null;
const port = await freePort();
// 셸에 부팅 값이 남아 있으면 .env를 덮으므로 빼고 돌린다. 배포물은 저장소의 모듈을 찾지 않아야 하므로
// 모듈 경로를 바꾸는 값도 뺀다.
const env = { ...process.env };
for (const name of [
  "WEB_HOST",
  "WEB_PORT",
  "DATABASE_PATH",
  "ENCRYPTION_KEY",
  "FACTORY_HOME",
  "NODE_PATH",
  "NODE_OPTIONS",
]) {
  delete env[name];
}

let output = "";
let failure: string | undefined;
let exitCode: number | null | undefined;
let child: ReturnType<typeof spawn> | undefined;
try {
  const cli =
    installDir === null
      ? join(REPO, "apps", "cli", "dist", "bin", "cli.js")
      : installBundle(installDir);
  // 배포물은 저장소 밖 설치 폴더에서 돌린다.
  const cwd = installDir ?? REPO;
  const init = spawnSync(nodePath, [cli, "init", "--home", home, "--port", String(port)], {
    cwd,
    env,
    encoding: "utf8",
  });
  if (init.error !== undefined) throw new Error(`could not run init: ${init.error.message}`);
  output += init.stdout + init.stderr;
  if (init.status !== 0) throw new Error(`init exited with ${init.status ?? init.signal}`);

  const started = spawn(nodePath, [cli, "start", "--home", home], {
    cwd,
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
  // 화면이 쓰는 정적 파일(web dist/client)도 나오는지 본다.
  const asset = /(?:src|href)="(\/assets\/[^"]+\.js)"/.exec(await response.text())?.[1];
  if (asset === undefined) throw new Error("GET /runs returned no script asset");
  const assetResponse = await fetch(`http://127.0.0.1:${port}${asset}`);
  if (assetResponse.status !== 200)
    throw new Error(`GET ${asset} returned ${assetResponse.status}`);
  console.log(`GET ${asset} -> ${assetResponse.status}`);

  const db = new DatabaseSync(join(home, "data", "factory-orchestrator.db"));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const applied = db.prepare("SELECT count(*) AS n FROM schema_migrations").get()?.["n"];
    if (typeof applied !== "number" || applied === 0) throw new Error("no migrations were applied");
    console.log(`schema_migrations: ${applied} row(s)`);

    // 실제 Orca 러너 어댑터로 확인하게 한다. `.invalid`는 이름이 풀리지 않도록 예약된 최상위 도메인이다.
    db.prepare(
      "INSERT INTO runners (id, kind, name, config, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "smoke-runner",
      "orca",
      "Smoke runner",
      JSON.stringify({ sshTarget: "factory-smoke.invalid", connectTimeoutSeconds: 5 }),
      1,
      Date.now(),
    );
    const check = db.prepare(
      "SELECT online, checked_at AS checkedAt, check_error AS checkError FROM runners WHERE id = ?",
    );
    let row: Record<string, unknown> | undefined;
    await waitFor(
      () => {
        row = check.get("smoke-runner");
        return row?.["checkedAt"] !== null && row?.["checkedAt"] !== undefined;
      },
      RUNNER_CHECK_TIMEOUT_MS,
      "worker did not record a runner check",
    );
    if (row?.["online"] !== 0)
      throw new Error(`runner check recorded online=${String(row?.["online"])}`);
    if (typeof row?.["checkError"] !== "string") throw new Error("runner check recorded no error");
    console.log(`runner check recorded: offline, error ${row["checkError"]}`);
  } finally {
    db.close();
  }

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
  if (installDir !== null) rmSync(installDir, { recursive: true, force: true });
}

if (failure !== undefined) {
  console.error(`cli smoke test failed: ${failure}\n--- output ---\n${output}`);
  process.exitCode = 1;
}

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createServer } from "vite";
import { devPageRoutes, injectDevTools, swapWebAdapters } from "./plugins.ts";
import type { DevMode } from "./runtime.ts";

/*
 * 개발 진입점 `pnpm dev`(티켓 0047). web 개발 서버(핫 리로드)와 worker 를 한 프로세스에서 띄우고, 트래커·러너·
 * 코드 호스트는 가짜 어댑터로 돈다. 실제 Linear·ssh·GitHub 에 닿지 않고 토큰도 필요 없다.
 *
 *   pnpm dev                 미리 채운 모드: 온보딩을 마친 설치와 모든 상태의 런, 지난 2주 런
 *   pnpm dev --onboarding    온보딩 모드: 빈 DB 에서 온보딩 1단계부터
 *   pnpm dev --reset         그 모드의 데이터를 지우고 처음 상태로 띄운다
 *   pnpm dev --static        가짜 에이전트가 스스로 움직이지 않는다
 *
 * 데이터는 저장소의 .dev/<모드>/ 에 둔다(gitignore). FACTORY_DEV_DIR 로 바꿀 수 있다. 실제 설치 폴더
 * (~/.factory-orchestrator)는 건드리지 않는다. 바인드 주소·포트는 WEB_HOST·WEB_PORT(기본 127.0.0.1:3000)다.
 */

const repoRoot = resolve(import.meta.dirname, "../..");
const webRoot = join(repoRoot, "apps/web");

const { values } = parseArgs({
  options: {
    onboarding: { type: "boolean", default: false },
    reset: { type: "boolean", default: false },
    static: { type: "boolean", default: false },
  },
  strict: true,
});

const mode: DevMode = values.onboarding ? "onboarding" : "seeded";
const devRoot = resolve(process.env["FACTORY_DEV_DIR"] ?? join(repoRoot, ".dev"));
const dataDir = join(devRoot, mode);
if (values.reset && existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true });
  console.info(`[dev] reset ${dataDir}`);
}
mkdirSync(dataDir, { recursive: true });

// 암호화 키는 이 개발 폴더에 한 번 만들어 둔다. 가짜 토큰만 봉하지만 실제 설치처럼 키로 연다.
const keyFile = join(dataDir, "encryption-key");
if (!existsSync(keyFile)) {
  writeFileSync(keyFile, randomBytes(32).toString("base64"), { mode: 0o600 });
}
const encryptionKeyText = readFileSync(keyFile, "utf8").trim();
const databasePath = join(dataDir, "factory-orchestrator.db");
const host = process.env["WEB_HOST"] ?? "127.0.0.1";
const portText = process.env["WEB_PORT"] ?? "3000";
const port = Number(portText);
// web 의 부팅 설정(packages/db parseBootConfig)과 같이 1~65535 의 십진수만 받는다.
if (!/^\d+$/.test(portText) || port < 1 || port > 65_535) {
  throw new Error(`WEB_PORT must be a port number: ${process.env["WEB_PORT"]}`);
}

// web 은 부팅 설정을 환경 변수로 읽는다(packages/db parseBootConfig).
process.env["DATABASE_PATH"] = databasePath;
process.env["ENCRYPTION_KEY"] = encryptionKeyText;
process.env["WEB_HOST"] = host;
process.env["WEB_PORT"] = String(port);

const server = await createServer({
  root: webRoot,
  configFile: join(webRoot, "vite.config.ts"),
  plugins: [swapWebAdapters(), injectDevTools(), devPageRoutes()],
  server: {
    host,
    port,
    strictPort: true,
    // 개발 데이터(암호화 키, DB)는 저장소 안에 있어도 개발 서버가 파일로 내주지 않는다.
    fs: { deny: [".dev/**", "**/encryption-key", "**/*.db", "**/*.db-*"] },
  },
});

// 워크스페이스 패키지는 소스(.ts)라 Node 가 바로 읽지 못해 vite 로 싣는다. 실으면 globalThis.__factoryDev 를 둔다.
await server.ssrLoadModule(join(import.meta.dirname, "runtime.ts"));
const dev = globalThis.__factoryDev;
if (dev === undefined) throw new Error("dev runtime did not load");
const runtime = await dev.start({
  mode,
  databasePath,
  encryptionKey: new Uint8Array(Buffer.from(encryptionKeyText, "base64")),
  life: !values.static,
});

await server.listen();
const address = server.httpServer?.address();
const listening = typeof address === "object" && address !== null ? address.port : port;
const shown = host === "0.0.0.0" ? "127.0.0.1" : host.includes(":") ? `[${host}]` : host;
console.info(
  [
    `[dev] ${mode === "seeded" ? "seeded data" : "onboarding"}${runtime.seeded ? " (new seed)" : ""}, data in ${dataDir}`,
    `[dev] Web is listening at http://${shown}:${listening}`,
    `[dev] Dev tools at http://${shown}:${listening}/__dev`,
  ].join("\n"),
);

let stopping = false;
const stop = (signal: NodeJS.Signals): void => {
  if (stopping) return;
  stopping = true;
  console.info(`[dev] ${signal} received, stopping`);
  Promise.all([runtime.stop(), server.close()]).then(
    () => process.exit(0),
    (error: unknown) => {
      console.error("[dev] could not stop cleanly", error);
      process.exit(1);
    },
  );
};
// vite 개발 서버는 SIGTERM 에 web 만 닫고 바로 끝낸다. worker 를 먼저 멈추고 DB 를 닫도록 그 처리를 바꾼다.
process.removeAllListeners("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BootConfig } from "@factory/db";

/** `start`가 띄우는 자식 프로세스 하나 */
export interface ProcessSpec {
  name: "web" | "worker";
  command: string;
  args: string[];
  cwd: string;
  /** 띄우기 전에 있어야 하는 빌드 산출물. 없으면 띄우지 않고 알린다 */
  requires: string[];
}

/** web과 worker 빌드 산출물을 어떻게 띄우는지(ADR 0002: 두 프로세스) */
export interface AppLayout {
  web(config: BootConfig): ProcessSpec;
  worker(): ProcessSpec;
}

/** 서버 배포물 안에서 web·worker 산출물(각 앱의 `dist`)을 두는 폴더. 배포물 루트 기준이다 */
export const BUNDLE_DIRS = { cli: "cli", web: "web", worker: "worker" } as const;

/**
 * CLI가 놓인 곳에서 web과 worker 빌드 산출물을 찾는다. 서버 배포물(`pnpm run bundle`, 0029)에서는 CLI 옆의
 * `web`·`worker` 폴더를, 저장소(pnpm 워크스페이스)에서는 CLI 패키지 옆 `apps/web`·`apps/worker`의 `dist`를
 * 쓴다. 두 곳 모두 산출물이 의존성까지 묶여 있어 `node_modules` 없이 돈다.
 */
export function appLayout(from: string = fileURLToPath(import.meta.url)): AppLayout {
  const root = packageRoot(from);
  const bundled = join(root, BUNDLE_DIRS.web);
  if (existsSync(bundled)) return distLayout(bundled, join(root, BUNDLE_DIRS.worker));
  const appsDir = dirname(root);
  return distLayout(join(appsDir, "web", "dist"), join(appsDir, "worker", "dist"));
}

/**
 * web·worker의 `dist` 폴더로 띄울 명령을 만든다. web은 `pnpm --filter @factory/web start`와 같은
 * srvx 명령을 pnpm 없이 Node로 바로 돌린다. srvx도 `dist/srvx`에 묶여 있다.
 */
function distLayout(webDist: string, workerDist: string): AppLayout {
  const srvx = join(webDist, "srvx", "srvx.js");
  const serverEntry = join(webDist, "server", "server.js");
  const clientDir = join(webDist, "client");
  const workerEntry = join(workerDist, "server", "main.js");
  return {
    web: (config) => ({
      name: "web",
      command: process.execPath,
      args: [
        srvx,
        "--prod",
        "--host",
        config.host,
        "--port",
        String(config.port),
        "--static",
        clientDir,
        serverEntry,
      ],
      cwd: webDist,
      requires: [srvx, serverEntry, clientDir],
    }),
    worker: () => ({
      name: "worker",
      command: process.execPath,
      args: [workerEntry],
      cwd: workerDist,
      requires: [workerEntry],
    }),
  };
}

/** 소스(`src/`)로 돌 때도 번들(`dist/bin/`)로 돌 때도 같은 곳이 나오도록 package.json이 있는 폴더를 찾는다. */
function packageRoot(from: string): string {
  let dir = dirname(from);
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`package.json not found above ${from}`);
    dir = parent;
  }
  return dir;
}

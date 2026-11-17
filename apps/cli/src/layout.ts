import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
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

/**
 * 저장소(pnpm 워크스페이스) 안에서 빌드한 web과 worker를 띄운다. CLI 패키지 옆의 `apps/web`,
 * `apps/worker`의 `dist`를 쓴다. npm 패키지로 묶을 때의 배치는 0029가 정하고 이 함수만 바꾼다.
 *
 * web은 `pnpm --filter @factory/web start`와 같은 srvx 명령을 pnpm 없이 Node로 바로 돌린다.
 */
export function workspaceLayout(from: string = fileURLToPath(import.meta.url)): AppLayout {
  const appsDir = dirname(packageRoot(from));
  const webDir = join(appsDir, "web");
  const workerDir = join(appsDir, "worker");
  const serverEntry = join(webDir, "dist", "server", "server.js");
  const clientDir = join(webDir, "dist", "client");
  const workerEntry = join(workerDir, "dist", "server", "main.js");
  return {
    web: (config) => {
      const srvx = srvxBin(webDir);
      return {
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
        cwd: webDir,
        requires: [srvx, serverEntry, clientDir],
      };
    },
    worker: () => ({
      name: "worker",
      command: process.execPath,
      args: [workerEntry],
      cwd: workerDir,
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

/** web이 쓰는 srvx 버전의 실행 파일. srvx는 `./package.json`을 내보내지 않아 `./cli`에서 찾아간다. */
function srvxBin(webDir: string): string {
  try {
    const cli = createRequire(join(webDir, "package.json")).resolve("srvx/cli");
    return resolve(dirname(cli), "..", "bin", "srvx.mjs");
  } catch {
    // 설치가 안 된 경우. requires 검사가 이 경로가 없다고 알린다.
    return join(webDir, "node_modules", "srvx", "bin", "srvx.mjs");
  }
}

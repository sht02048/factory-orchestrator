import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BootConfig } from "@ganger/db";

export interface ProcessSpec {
  name: "web" | "worker";
  command: string;
  args: string[];
  cwd: string;
  requires: string[];
}

export interface AppLayout {
  web(config: BootConfig): ProcessSpec;
  worker(): ProcessSpec;
}

export const BUNDLE_DIRS = { cli: "cli", web: "web", worker: "worker" } as const;

export function appLayout(from: string = fileURLToPath(import.meta.url)): AppLayout {
  const root = packageRoot(from);
  const bundled = join(root, BUNDLE_DIRS.web);
  if (existsSync(bundled)) return distLayout(bundled, join(root, BUNDLE_DIRS.worker));
  const appsDir = dirname(root);
  return distLayout(join(appsDir, "web", "dist"), join(appsDir, "worker", "dist"));
}

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

function packageRoot(from: string): string {
  let dir = dirname(from);
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`package.json not found above ${from}`);
    dir = parent;
  }
  return dir;
}

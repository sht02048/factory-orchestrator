import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { desktopDevEnv, electronBinary, superviseDesktop } from "./desktop-process.ts";
import { repoRoot, startDevServer } from "./server.ts";

const FORCE_QUIT_AFTER_MS = 10_000;
const DESKTOP_VITE_CONFIGS = [
  "vite.main.config.ts",
  "vite.preload.config.ts",
  "vite.renderer.config.ts",
];

const desktopRoot = join(repoRoot, "apps/desktop");
const desktopRequire = createRequire(join(desktopRoot, "package.json"));
const launchEnv = { ...process.env };

const electron = electronBinary(() => desktopRequire("electron"), existsSync);
if (!electron.ok) {
  console.error(electron.message);
  process.exit(1);
}

const [built, started] = await Promise.allSettled([
  buildDesktop(),
  startDevServer(process.argv.slice(2)),
]);
if (built.status === "rejected" || started.status === "rejected") {
  if (started.status === "fulfilled") await started.value.stop();
  for (const result of [built, started]) {
    if (result.status === "rejected") console.error(result.reason);
  }
  process.exit(1);
}
const server = started.value;

console.info(`[dev] opening the desktop app on ${server.url}`);
const child = spawn(electron.path, [desktopRoot], {
  cwd: desktopRoot,
  env: desktopDevEnv(launchEnv, server),
  stdio: "inherit",
});
const code = await superviseDesktop({
  child,
  stopServer: () => server.stop(),
  signals: process,
  log: (line) => console.info(line),
  forceQuitAfterMs: FORCE_QUIT_AFTER_MS,
});
process.exit(code);

async function buildDesktop(): Promise<void> {
  const vite = join(dirname(desktopRequire.resolve("vite/package.json")), "bin", "vite.js");
  for (const config of DESKTOP_VITE_CONFIGS) {
    await runQuietly(process.execPath, [vite, "build", "-c", config, "--logLevel", "error"], {
      cwd: desktopRoot,
      env: { ...launchEnv, VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" },
    });
  }
}

function runQuietly(
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string | undefined> },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const build = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    build.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    build.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    build.once("error", reject);
    build.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`desktop build failed: ${args.join(" ")}\n${output}`)),
    );
  });
}

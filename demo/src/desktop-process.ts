import { join } from "node:path";

export const ELECTRON_INSTALL_COMMAND =
  "pnpm --filter @ganger/desktop exec node node_modules/electron/install.js";

export type ElectronBinary = { ok: true; path: string } | { ok: false; message: string };

export function electronBinary(
  load: () => unknown,
  exists: (path: string) => boolean,
): ElectronBinary {
  const missing: ElectronBinary = {
    ok: false,
    message: [
      "[dev] Electron is not installed, so the desktop app cannot start.",
      `[dev] Download it once with: ${ELECTRON_INSTALL_COMMAND}`,
      "[dev] To open the web app in a browser instead, run: pnpm dev:web",
    ].join("\n"),
  };
  let path: unknown;
  try {
    path = load();
  } catch {
    return missing;
  }
  if (typeof path !== "string" || !exists(path)) return missing;
  return { ok: true, path };
}

export function desktopDevEnv(
  launchEnv: Readonly<Record<string, string | undefined>>,
  server: { url: string; devRoot: string },
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...launchEnv,
    GANGER_DESKTOP_DEV_SERVER: server.url,
    GANGER_DESKTOP_USER_DATA: join(server.devRoot, "desktop", "user-data"),
    GANGER_HOME: join(server.devRoot, "desktop", "home"),
  };
  delete env["ELECTRON_RUN_AS_NODE"];
  return env;
}

export interface DesktopChild {
  kill(signal: NodeJS.Signals): boolean;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
}

export interface StopSignals {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface Supervision {
  child: DesktopChild;
  stopServer: () => Promise<void>;
  signals: StopSignals;
  log: (line: string) => void;
  forceQuitAfterMs: number;
}

export function superviseDesktop({
  child,
  stopServer,
  signals,
  log,
  forceQuitAfterMs,
}: Supervision): Promise<number> {
  return new Promise((resolve) => {
    let signalled = false;
    let finished = false;
    let forceTimer: NodeJS.Timeout | undefined;
    const finish = (code: number, reason: string): void => {
      if (finished) return;
      finished = true;
      if (forceTimer !== undefined) clearTimeout(forceTimer);
      log(`[dev] ${reason}, stopping the dev server`);
      stopServer().then(
        () => resolve(code),
        (error: unknown) => {
          log(`[dev] could not stop the dev server cleanly: ${String(error)}`);
          resolve(1);
        },
      );
    };
    const quit = (signal: NodeJS.Signals): void => {
      if (signalled || finished) return;
      signalled = true;
      log(`[dev] ${signal} received, quitting the desktop app`);
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), forceQuitAfterMs);
    };
    signals.on("SIGINT", () => quit("SIGINT"));
    signals.on("SIGTERM", () => quit("SIGTERM"));
    child.once("exit", (code, signal) =>
      finish(
        signalled || code === 0 || signal === "SIGINT" || signal === "SIGTERM" ? 0 : (code ?? 1),
        "desktop app quit",
      ),
    );
    child.once("error", (error) => finish(1, `desktop app could not start (${error.message})`));
  });
}

import { spawn } from "node:child_process";
import type { PowerSettingsRead } from "@ganger/app/power-settings";

export const KEEP_AWAKE_POLL_MS = 5_000;
export const CAFFEINATE_PATH = "/usr/bin/caffeinate";

export interface SleepAssertion {
  exited: Promise<string>;
  release(): void;
}

export type HoldSleepAssertion = (serverPid: number) => SleepAssertion;

export const caffeinate: HoldSleepAssertion = (serverPid) => {
  const child = spawn(CAFFEINATE_PATH, ["-i", "-w", String(serverPid)], { stdio: "ignore" });
  let running = true;
  const exited = new Promise<string>((resolve) => {
    child.once("error", (error) => {
      running = false;
      resolve(`could not start caffeinate: ${error.message}`);
    });
    child.once("exit", (code, signal) => {
      running = false;
      resolve(
        signal === null
          ? `caffeinate exited with code ${code ?? "unknown"}`
          : `caffeinate was killed by ${signal}`,
      );
    });
  });
  return {
    exited,
    release: () => {
      if (running) child.kill("SIGTERM");
    },
  };
};

export interface KeepAwakeOptions {
  platform: NodeJS.Platform;
  serverPid: number;
  readSettings: () => PowerSettingsRead;
  hold: HoldSleepAssertion;
  warn: (line: string) => void;
  pollMs?: number;
}

export interface KeepAwake {
  readonly holding: boolean;
  refresh(): void;
  stop(): void;
}

export function keepAwake(options: KeepAwakeOptions): KeepAwake {
  let assertion: SleepAssertion | undefined;
  let gaveUp = false;
  let stopped = false;
  let lastProblem: string | undefined;

  const release = () => {
    const current = assertion;
    assertion = undefined;
    current?.release();
  };

  const hold = () => {
    let current: SleepAssertion;
    try {
      current = options.hold(options.serverPid);
    } catch (error) {
      giveUp(error instanceof Error ? error.message : String(error));
      return;
    }
    assertion = current;
    void current.exited.then((reason) => {
      if (assertion !== current) return;
      assertion = undefined;
      giveUp(reason);
    });
  };

  const giveUp = (reason: string) => {
    gaveUp = true;
    options.warn(`Warning: could not keep this Mac awake (${reason}). The server keeps running.`);
  };

  const refresh = () => {
    if (stopped) return;
    const { settings, problem } = options.readSettings();
    if (problem !== undefined && problem !== lastProblem) {
      options.warn(`Warning: could not read power settings (${problem}). Keeping this Mac awake.`);
    }
    lastProblem = problem;
    const wanted = settings.preventSleep && options.platform === "darwin";
    if (!wanted) {
      gaveUp = false;
      release();
      return;
    }
    if (assertion === undefined && !gaveUp) hold();
  };

  refresh();
  const timer = setInterval(refresh, options.pollMs ?? KEEP_AWAKE_POLL_MS);
  timer.unref();

  return {
    get holding() {
      return assertion !== undefined;
    },
    refresh,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      release();
    },
  };
}

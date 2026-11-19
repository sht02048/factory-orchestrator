import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import {
  ENROLLMENT_ACCEPT_PATH,
  ENROLLMENT_OFFER_PATH,
  GITHUB_SETUP_RESULTS,
  PROGRESS_ENV,
  PROGRESS_FAIL_PREFIX,
  PROGRESS_GITHUB_PREFIX,
  PROGRESS_STEP_PREFIX,
  SETUP_PROGRESS_STEPS,
} from "@ganger/app/runner-setup/enrollment-protocol";
import type {
  GitHubSetupResult,
  SetupProgressStep,
} from "@ganger/app/runner-setup/enrollment-protocol";
import { OFFER_GONE, SETUP_PROBLEMS, START_PROGRESS } from "../shared/enrollment.js";
import type { EnrollStep, OfferGone, SetupProblem, SetupProgress } from "../shared/enrollment.js";
import type { Probe } from "./identity.js";
import type { SavedServer } from "./remote.js";

export const OFFER_POLL_MS = 3_000;
const REQUEST_TIMEOUT_MS = 5_000;
const SCRIPT_LIMIT = 256 * 1024;
const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/sbin", "/sbin"];

export interface RunnerOffer {
  id: string;
  expiresInMs: number;
}

const offerResponseSchema = z.object({
  offer: z.object({ id: z.string().min(1).max(100), expiresInMs: z.number().min(0) }).nullable(),
});

export async function fetchOffer(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RunnerOffer | null | undefined> {
  try {
    const response = await fetchImpl(new URL(ENROLLMENT_OFFER_PATH, origin), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return undefined;
    const parsed = offerResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.offer : undefined;
  } catch {
    return undefined;
  }
}

export type AcceptResult =
  | { ok: true; script: string }
  | { ok: false; gone: OfferGone }
  | { ok: false; gone: null };

const acceptResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), script: z.string().min(1).max(SCRIPT_LIMIT) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export async function acceptOffer(
  origin: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AcceptResult> {
  try {
    const response = await fetchImpl(new URL(ENROLLMENT_ACCEPT_PATH, origin), {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ id }),
    });
    const parsed = acceptResponseSchema.safeParse(await response.json());
    if (!parsed.success) return { ok: false, gone: null };
    if (parsed.data.ok) return { ok: true, script: parsed.data.script };
    const gone = z.enum(OFFER_GONE).safeParse(parsed.data.reason);
    return { ok: false, gone: gone.success ? gone.data : null };
  } catch {
    return { ok: false, gone: null };
  }
}

export type SetupEvent =
  | { kind: "step"; step: SetupProgressStep }
  | { kind: "github"; result: GitHubSetupResult }
  | { kind: "fail"; problem: SetupProblem };

const stepSchema = z.enum(SETUP_PROGRESS_STEPS);
const githubSchema = z.enum(GITHUB_SETUP_RESULTS);
const problemSchema = z.enum(SETUP_PROBLEMS).catch("script-failed");

export function parseProgressLine(line: string): SetupEvent | null {
  const text = line.trim();
  if (text.startsWith(PROGRESS_STEP_PREFIX)) {
    const step = stepSchema.safeParse(text.slice(PROGRESS_STEP_PREFIX.length));
    return step.success ? { kind: "step", step: step.data } : null;
  }
  if (text.startsWith(PROGRESS_GITHUB_PREFIX)) {
    const result = githubSchema.safeParse(text.slice(PROGRESS_GITHUB_PREFIX.length));
    return result.success ? { kind: "github", result: result.data } : null;
  }
  if (text.startsWith(PROGRESS_FAIL_PREFIX)) {
    return { kind: "fail", problem: problemSchema.parse(text.slice(PROGRESS_FAIL_PREFIX.length)) };
  }
  return null;
}

const STEP_OF: Record<Exclude<SetupProgressStep, "remote-login-wait">, EnrollStep> = {
  "remote-login": "remoteLogin",
  key: "key",
  service: "service",
  github: "github",
  report: "register",
};

export function nextProgress(progress: SetupProgress, event: SetupEvent): SetupProgress {
  switch (event.kind) {
    case "step":
      if (event.step === "remote-login-wait") return { ...progress, waitingForRemoteLogin: true };
      return {
        ...progress,
        waitingForRemoteLogin: false,
        done: progress.done.includes(STEP_OF[event.step])
          ? progress.done
          : [...progress.done, STEP_OF[event.step]],
      };
    case "github":
      return { ...progress, github: event.result };
    case "fail":
      return { ...progress, waitingForRemoteLogin: false, problem: event.problem };
  }
}

export function setupEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const path = [...(base["PATH"] ?? "/usr/bin:/bin").split(":"), ...EXTRA_PATH]
    .filter((part, index, all) => part !== "" && all.indexOf(part) === index)
    .join(":");
  return { ...base, PATH: path, [PROGRESS_ENV]: "1" };
}

export interface SetupShell {
  command: string;
  args: ReadonlyArray<string>;
}

export const DEFAULT_SHELL: SetupShell = { command: "/bin/sh", args: ["-s"] };

export interface SetupRun {
  cancel(): void;
  finished: Promise<SetupProgress>;
}

export function runSetupScript(
  script: string,
  onProgress: (progress: SetupProgress) => void,
  options: { shell?: SetupShell; env?: NodeJS.ProcessEnv } = {},
): SetupRun {
  const shell = options.shell ?? DEFAULT_SHELL;
  const child = spawn(shell.command, [...shell.args], {
    stdio: ["pipe", "pipe", "ignore"],
    detached: true,
    env: setupEnv(options.env ?? process.env),
  });
  let progress = START_PROGRESS;
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const event = parseProgressLine(line);
    if (event === null) return;
    progress = nextProgress(progress, event);
    onProgress(progress);
  });
  child.stdin.on("error", () => undefined);
  child.stdin.end(script);
  const finished = new Promise<SetupProgress>((resolve) => {
    const settle = (code: number | null) => {
      lines.close();
      if (code === 0 && progress.done.includes("register")) {
        resolve(progress);
        return;
      }
      resolve({ ...progress, problem: progress.problem ?? "script-failed" });
    };
    child.on("error", () => settle(null));
    child.on("close", settle);
  });
  return {
    cancel: () => {
      if (child.pid === undefined || child.exitCode !== null) return;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    },
    finished,
  };
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export async function isServerMac(
  server: SavedServer,
  probe: Probe,
  ports: ReadonlyArray<number>,
  timeoutMs = 1_000,
): Promise<boolean> {
  const url = new URL(server.url);
  if (LOOPBACK.has(url.hostname)) return true;
  const candidates = new Set(ports);
  if (url.port !== "") candidates.add(Number(url.port));
  for (const port of candidates) {
    const result = await probe(`http://127.0.0.1:${port}`, timeoutMs);
    if (result.kind === "ours" && result.identity.instanceId === server.instanceId) return true;
  }
  return false;
}

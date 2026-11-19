import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { hostname, userInfo, homedir } from "node:os";
import { isAbsolute } from "node:path";
import { DEFAULT_ORCA_PATH, serviceInstallArgs } from "@ganger/runner-orca";
import { z } from "zod";
import { failureDetail, runCommand } from "./commands.js";
import type { CommandRunner } from "./commands.js";
import {
  LOCAL_ONLY_KEY_OPTIONS,
  authorizeKey,
  ensureGangerSshKey,
  gangerSshPaths,
  parsePublicKey,
  pinHostKey,
} from "./ganger-ssh.js";
import type { GangerSshPaths } from "./ganger-ssh.js";
import type {
  GangerRunnerConfig,
  MachineStep,
  StepProblem,
  StepResult,
  TailscaleState,
  ThisMac,
  ThisMacStatus,
} from "./model.js";

export const LOCAL_HOST = "localhost";
export const SSH_PORT = 22;
const SYSTEM_HOST_KEY = "/etc/ssh/ssh_host_ed25519_key.pub";
const TAILSCALE_PATHS = [
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/local/bin/tailscale",
];
const GH_PATHS = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"];
const GITHUB_HOST = "github.com";
const SERVICE_TIMEOUT_MS = 120_000;

const accountSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/u, { error: "unsupported account name" });
const absolutePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine(isAbsolute)
  .refine((value) => !/[\n\r]/u.test(value));
const computerNameSchema = z.string().trim().min(1).max(100);
const tailscaleStatusSchema = z.object({ BackendState: z.string() });

export interface LocalThisMacOptions {
  gangerHome: string | undefined;
  userHome?: string;
  account?: string;
  shell?: string;
  run?: CommandRunner;
  probePort?: (port: number) => Promise<boolean>;
  isExecutable?: (path: string) => boolean;
  hostKeyFile?: string;
  defaultOrcaPath?: string;
  platform?: NodeJS.Platform;
}

export function probeLocalPort(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function loginShell(env: string | undefined): string {
  const parsed = absolutePathSchema.safeParse(env);
  return parsed.success && executable(parsed.data) ? parsed.data : "/bin/sh";
}

function preparedForLocalhost(paths: GangerSshPaths): boolean {
  try {
    const knownHosts = readFileSync(paths.knownHostsFile, "utf8");
    return (
      existsSync(paths.identityFile) &&
      knownHosts.split("\n").some((line) => line.startsWith(`${LOCAL_HOST} `))
    );
  } catch {
    return false;
  }
}

export function localThisMac(options: LocalThisMacOptions): ThisMac {
  const run = options.run ?? runCommand;
  const isExecutable = options.isExecutable ?? executable;
  const probePort = options.probePort ?? ((port: number) => probeLocalPort(port));
  const userHome = options.userHome ?? homedir();
  const shell = options.shell ?? loginShell(process.env["SHELL"]);
  const hostKeyFile = options.hostKeyFile ?? SYSTEM_HOST_KEY;
  const defaultOrcaPath = options.defaultOrcaPath ?? DEFAULT_ORCA_PATH;
  const platform = options.platform ?? process.platform;
  const paths: GangerSshPaths | null =
    options.gangerHome === undefined ? null : gangerSshPaths(options.gangerHome);

  const fail = (step: MachineStep | "register", problem: StepProblem, detail: string | null) =>
    ({ step, outcome: "failed", problem, detail }) satisfies StepResult;

  function account(): string | null {
    const parsed = accountSchema.safeParse(options.account ?? userInfo().username);
    return parsed.success ? parsed.data : null;
  }

  async function onPath(name: string): Promise<string | null> {
    const result = await run(shell, ["-lc", `command -v ${name}`], { timeoutMs: 10_000 });
    if (result.exitCode !== 0) return null;
    const parsed = absolutePathSchema.safeParse(result.stdout.trim().split("\n").at(-1));
    return parsed.success && isExecutable(parsed.data) ? parsed.data : null;
  }

  async function findOrca(): Promise<string | null> {
    if (isExecutable(defaultOrcaPath)) return defaultOrcaPath;
    return onPath("orca");
  }

  async function findGh(): Promise<string | null> {
    return GH_PATHS.find((path) => isExecutable(path)) ?? (await onPath("gh"));
  }

  async function computerName(): Promise<string> {
    if (platform === "darwin") {
      const result = await run("/usr/sbin/scutil", ["--get", "ComputerName"], {
        timeoutMs: 5_000,
      });
      const parsed = computerNameSchema.safeParse(result.stdout);
      if (result.exitCode === 0 && parsed.success) return parsed.data;
    }
    return computerNameSchema.catch("this-mac").parse(hostname().replace(/\.local$/u, ""));
  }

  async function tailscale(): Promise<TailscaleState> {
    const cli = TAILSCALE_PATHS.find((path) => isExecutable(path));
    if (cli === undefined) return "missing";
    const result = await run(cli, ["status", "--json"], { timeoutMs: 5_000 });
    let json: unknown = null;
    try {
      json = JSON.parse(result.stdout);
    } catch {
      return "disconnected";
    }
    const parsed = tailscaleStatusSchema.safeParse(json);
    return parsed.success && parsed.data.BackendState === "Running" ? "connected" : "disconnected";
  }

  async function keyStep(): Promise<StepResult> {
    if (paths === null) return fail("key", "no-home", null);
    const key = await ensureGangerSshKey(paths, run);
    if (!key.ok) return fail("key", "keygen-failed", key.detail);
    try {
      authorizeKey(userHome, key.publicKey, LOCAL_ONLY_KEY_OPTIONS);
    } catch (error) {
      return fail("key", "authorized-keys-failed", String(error));
    }
    return { step: "key", outcome: "done", detail: null };
  }

  function hostKeyStep(): StepResult {
    if (paths === null) return fail("hostKey", "no-home", null);
    let text: string;
    try {
      text = readFileSync(hostKeyFile, "utf8");
    } catch {
      return fail("hostKey", "host-key-missing", hostKeyFile);
    }
    const key = parsePublicKey(text);
    if (key === null) return fail("hostKey", "host-key-missing", hostKeyFile);
    try {
      pinHostKey(paths.knownHostsFile, LOCAL_HOST, key);
    } catch (error) {
      return fail("hostKey", "known-hosts-failed", String(error));
    }
    return { step: "hostKey", outcome: "done", detail: null };
  }

  async function orcaStep(): Promise<StepResult> {
    const path = await findOrca();
    return path === null
      ? fail("orca", "orca-not-found", null)
      : { step: "orca", outcome: "done", detail: path };
  }

  async function serviceStep(): Promise<StepResult> {
    const path = await findOrca();
    if (path === null) return fail("service", "orca-not-found", null);
    const [command, ...args] = serviceInstallArgs(path);
    const result = await run(command ?? path, args, { timeoutMs: SERVICE_TIMEOUT_MS });
    return result.exitCode === 0
      ? { step: "service", outcome: "done", detail: null }
      : fail("service", "service-failed", failureDetail(result));
  }

  async function githubStep(): Promise<StepResult> {
    const warn = (problem: StepProblem, detail: string | null): StepResult => ({
      step: "github",
      outcome: "warning",
      problem,
      detail,
    });
    const gh = await findGh();
    if (gh === null) return warn("gh-missing", null);
    const host = ["--hostname", GITHUB_HOST];
    const status = await run(gh, ["auth", "status", ...host], { timeoutMs: 15_000 });
    if (status.exitCode !== 0) return warn("gh-logged-out", null);
    const token = await run(gh, ["auth", "token", ...host], { timeoutMs: 15_000 });
    const secret = token.stdout.trim();
    if (token.exitCode !== 0 || secret === "") return warn("gh-logged-out", null);
    const login = await run(gh, ["auth", "login", ...host, "--insecure-storage", "--with-token"], {
      stdin: `${secret}\n`,
      timeoutMs: 30_000,
    });
    if (login.exitCode !== 0) return warn("gh-failed", failureDetail(login, [secret]));
    const setup = await run(gh, ["auth", "setup-git", ...host], { timeoutMs: 15_000 });
    if (setup.exitCode !== 0) return warn("gh-failed", failureDetail(setup, [secret]));
    return { step: "github", outcome: "done", detail: null };
  }

  return {
    async status(): Promise<ThisMacStatus> {
      const [name, orcaPath, remoteLogin, tailscaleState] = await Promise.all([
        computerName(),
        findOrca(),
        probePort(SSH_PORT),
        tailscale(),
      ]);
      return {
        name,
        account: account() ?? "",
        orcaPath,
        remoteLogin,
        tailscale: tailscaleState,
        gangerHomeKnown: paths !== null,
      };
    },
    async runStep(step) {
      switch (step) {
        case "key":
          return keyStep();
        case "hostKey":
          return hostKeyStep();
        case "orca":
          return orcaStep();
        case "service":
          return serviceStep();
        case "github":
          return githubStep();
      }
    },
    async runnerConfig() {
      if (paths === null) return { ok: false, result: fail("register", "no-home", null) };
      const user = account();
      if (user === null) return { ok: false, result: fail("register", "register-failed", null) };
      if (!preparedForLocalhost(paths)) {
        return { ok: false, result: fail("register", "setup-incomplete", null) };
      }
      const orcaPath = await findOrca();
      if (orcaPath === null) return { ok: false, result: fail("register", "orca-not-found", null) };
      const config: GangerRunnerConfig = {
        name: await computerName(),
        sshTarget: `${user}@${LOCAL_HOST}`,
        orcaPath,
        access: {
          kind: "ganger",
          identityFile: paths.identityFile,
          knownHostsFile: paths.knownHostsFile,
        },
      };
      return { ok: true, config };
    },
  };
}

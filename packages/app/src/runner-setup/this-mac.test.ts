import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretBox, listRunners, migrate, openDatabase, saveRunner } from "@ganger/db";
import { toRunnerId, toRunnerKind } from "@ganger/core";
import { AdapterRegistry } from "@ganger/core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { CommandResult, CommandRunner } from "./commands.js";
import { runCommand } from "./commands.js";
import { gangerSshPaths } from "./ganger-ssh.js";
import { saveRunnerSetting } from "../settings/actions.js";
import { registerThisMac } from "./register.js";
import { localThisMac } from "./this-mac.js";
import type { LocalThisMacOptions } from "./this-mac.js";

const ORCA = "/Applications/Orca.app/Contents/Resources/bin/orca";
const GH = "/opt/homebrew/bin/gh";
const TOKEN = "gho_secretTokenValue123";
const HOST_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHostKeyForTests root@this-mac";
const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGangerKeyForTests ganger";
const hasSshKeygen = existsSync("/usr/bin/ssh-keygen");

interface Call {
  command: string;
  args: ReadonlyArray<string>;
  stdin: string | undefined;
}

let root: string;
let userHome: string;
let gangerHome: string;
let hostKeyFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ganger-this-mac-"));
  userHome = join(root, "home");
  gangerHome = join(root, "ganger");
  hostKeyFile = join(root, "ssh_host_ed25519_key.pub");
  mkdirSync(userHome);
  writeFileSync(hostKeyFile, `${HOST_KEY}\n`);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function fakeRunner(responses: (call: Call) => Partial<CommandResult> | undefined): {
  run: CommandRunner;
  calls: Call[];
} {
  const calls: Call[] = [];
  const run: CommandRunner = async (command, args, options) => {
    const call = { command, args, stdin: options?.stdin };
    calls.push(call);
    if (command === "ssh-keygen" && args.includes("-f") && args.includes("ed25519")) {
      const file = args.at(-1) ?? "";
      writeFileSync(file, "PRIVATE", { mode: 0o600 });
      writeFileSync(`${file}.pub`, `${PUBLIC_KEY}\n`);
    }
    return { exitCode: 0, stdout: "", stderr: "", ...responses(call) };
  };
  return { run, calls };
}

function mac(run: CommandRunner, overrides: Partial<LocalThisMacOptions> = {}) {
  return localThisMac({
    gangerHome,
    userHome,
    account: "ganger",
    shell: "/bin/sh",
    run,
    probePort: async () => true,
    isExecutable: (path) => path === ORCA || path === GH,
    hostKeyFile,
    platform: "linux",
    ...overrides,
  });
}

const mode = (path: string) => statSync(path).mode & 0o777;

describe("this mac as a runner", () => {
  test("authorizes the Ganger key once with 700/600 permissions", async () => {
    const { run } = fakeRunner(() => undefined);
    const thisMac = mac(run);
    expect(await thisMac.runStep("key")).toEqual({ step: "key", outcome: "done", detail: null });
    expect(await thisMac.runStep("key")).toMatchObject({ outcome: "done" });
    const authorized = join(userHome, ".ssh", "authorized_keys");
    const lines = readFileSync(authorized, "utf8").trim().split("\n");
    expect(lines).toEqual([
      'from="127.0.0.1,::1" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGangerKeyForTests ganger',
    ]);
    expect(mode(join(userHome, ".ssh"))).toBe(0o700);
    expect(mode(authorized)).toBe(0o600);
    expect(mode(gangerSshPaths(gangerHome).identityFile)).toBe(0o600);
  });

  test("keeps keys already in authorized_keys", async () => {
    mkdirSync(join(userHome, ".ssh"), { mode: 0o755 });
    writeFileSync(join(userHome, ".ssh", "authorized_keys"), "ssh-rsa AAAAB3Other me@laptop", {
      mode: 0o644,
    });
    const { run } = fakeRunner(() => undefined);
    await mac(run).runStep("key");
    const authorized = join(userHome, ".ssh", "authorized_keys");
    expect(readFileSync(authorized, "utf8")).toBe(
      'ssh-rsa AAAAB3Other me@laptop\nfrom="127.0.0.1,::1" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGangerKeyForTests ganger\n',
    );
    expect(mode(join(userHome, ".ssh"))).toBe(0o700);
    expect(mode(authorized)).toBe(0o600);
  });

  test("pins the localhost host key in Ganger's known_hosts without duplicates", async () => {
    const { run } = fakeRunner(() => undefined);
    const thisMac = mac(run);
    expect(await thisMac.runStep("hostKey")).toMatchObject({ outcome: "done" });
    expect(await thisMac.runStep("hostKey")).toMatchObject({ outcome: "done" });
    const knownHosts = readFileSync(gangerSshPaths(gangerHome).knownHostsFile, "utf8");
    expect(knownHosts).toBe("localhost ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHostKeyForTests\n");
    expect(existsSync(join(userHome, ".ssh", "known_hosts"))).toBe(false);
  });

  test("names the missing host key file when sshd has no ed25519 key", async () => {
    const { run } = fakeRunner(() => undefined);
    const missing = join(root, "none.pub");
    expect(await mac(run, { hostKeyFile: missing }).runStep("hostKey")).toEqual({
      step: "hostKey",
      outcome: "failed",
      problem: "host-key-missing",
      detail: missing,
    });
  });

  test("finds orca at the app path first, then on the login shell PATH", async () => {
    const { run } = fakeRunner((call) =>
      call.args.includes("command -v orca") ? { stdout: "/opt/orca/bin/orca\n" } : undefined,
    );
    expect(await mac(run).runStep("orca")).toMatchObject({ outcome: "done", detail: ORCA });
    const fromPath = mac(run, { isExecutable: (path) => path === "/opt/orca/bin/orca" });
    expect(await fromPath.runStep("orca")).toMatchObject({
      outcome: "done",
      detail: "/opt/orca/bin/orca",
    });
    const nowhere = mac(fakeRunner(() => ({ exitCode: 1 })).run, { isExecutable: () => false });
    expect(await nowhere.runStep("orca")).toMatchObject({
      outcome: "failed",
      problem: "orca-not-found",
    });
  });

  test("installs the Orca service with options the CLI knows and reports its error", async () => {
    const { run, calls } = fakeRunner((call) =>
      call.args.includes("install")
        ? { exitCode: 2, stderr: "error: cli_not_found\nmore" }
        : undefined,
    );
    expect(await mac(run).runStep("service")).toEqual({
      step: "service",
      outcome: "failed",
      problem: "service-failed",
      detail: "error: cli_not_found more",
    });
    expect(calls.at(-1)).toMatchObject({
      command: ORCA,
      args: ["serve", "service", "install", "--bind", "127.0.0.1", "--command", ORCA],
    });
  });

  test("only warns when gh is missing or logged out", async () => {
    const none = mac(fakeRunner(() => ({ exitCode: 1 })).run, {
      isExecutable: (path) => path === ORCA,
    });
    expect(await none.runStep("github")).toEqual({
      step: "github",
      outcome: "warning",
      problem: "gh-missing",
      detail: null,
    });
    const loggedOut = mac(
      fakeRunner((call) => (call.args[1] === "status" ? { exitCode: 1 } : undefined)).run,
    );
    expect(await loggedOut.runStep("github")).toMatchObject({
      outcome: "warning",
      problem: "gh-logged-out",
    });
  });

  test("moves the gh token to file storage without leaking it into the result", async () => {
    const { run, calls } = fakeRunner((call) => {
      if (call.args[1] === "token") return { stdout: `${TOKEN}\n` };
      if (call.args[1] === "setup-git") return { exitCode: 1, stderr: `bad ${TOKEN}` };
      return undefined;
    });
    const result = await mac(run).runStep("github");
    expect(result).toMatchObject({ outcome: "warning", problem: "gh-failed", detail: "bad ***" });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    const login = calls.find((call) => call.args[1] === "login");
    expect(login?.args).toEqual([
      "auth",
      "login",
      "--hostname",
      "github.com",
      "--insecure-storage",
      "--with-token",
    ]);
    expect(login?.stdin).toBe(`${TOKEN}\n`);
    expect(calls.every((call) => !call.args.join(" ").includes(TOKEN))).toBe(true);
  });

  test("fails every step with no-home when the Ganger home is unknown", async () => {
    const thisMac = mac(fakeRunner(() => undefined).run, { gangerHome: undefined });
    expect(await thisMac.runStep("key")).toMatchObject({ problem: "no-home" });
    expect((await thisMac.status()).gangerHomeKnown).toBe(false);
  });

  test("reads the mac status", async () => {
    const thisMac = mac(fakeRunner(() => undefined).run, { probePort: async () => false });
    expect(await thisMac.status()).toMatchObject({
      account: "ganger",
      orcaPath: ORCA,
      remoteLogin: false,
      tailscale: "missing",
      gangerHomeKnown: true,
    });
  });

  test.runIf(hasSshKeygen)("creates a real passphrase-less ed25519 key", async () => {
    const thisMac = mac(runCommand);
    expect(await thisMac.runStep("key")).toMatchObject({ outcome: "done" });
    const paths = gangerSshPaths(gangerHome);
    expect(mode(paths.identityFile)).toBe(0o600);
    expect(mode(paths.dir)).toBe(0o700);
    const fingerprint = execFileSync("ssh-keygen", ["-l", "-f", paths.publicKeyFile], {
      encoding: "utf8",
    });
    expect(fingerprint).toMatch(/ED25519/);
    const derived = execFileSync("ssh-keygen", ["-y", "-P", "", "-f", paths.identityFile], {
      encoding: "utf8",
    });
    expect(readFileSync(paths.publicKeyFile, "utf8")).toContain(derived.trim());
  });
});

describe("registerThisMac", () => {
  function context() {
    const db = openDatabase(":memory:");
    migrate(db);
    return {
      db,
      secretBox: new SecretBox(new Uint8Array(32)),
      registry: new AdapterRegistry(),
    };
  }

  test("registers account@localhost with one slot and Ganger ssh access", async () => {
    const ctx = context();
    const registered = await registerThisMac(ctx, mac(fakeRunner(() => undefined).run), new Date());
    expect(registered.result).toEqual({
      step: "register",
      outcome: "done",
      detail: "ganger@localhost",
    });
    const [runner] = listRunners(ctx.db);
    expect(runner?.capacity).toBe(1);
    expect(runner?.config).toEqual({
      sshTarget: "ganger@localhost",
      orcaPath: ORCA,
      access: {
        kind: "ganger",
        identityFile: join(gangerHome, "ssh", "id_ed25519"),
        knownHostsFile: join(gangerHome, "ssh", "known_hosts"),
      },
    });
  });

  test("editing a Ganger runner keeps Ganger access only while the ssh target stays the same", async () => {
    const ctx = context();
    const registered = await registerThisMac(ctx, mac(fakeRunner(() => undefined).run), new Date());
    const id = registered.runnerId ?? "";
    const edit = (sshTarget: string) =>
      saveRunnerSetting(
        ctx,
        { id, name: "studio", sshTarget, orcaPath: ORCA, capacity: 2 },
        new Date(),
      );
    edit("ganger@localhost");
    expect(listRunners(ctx.db)[0]?.config).toMatchObject({ access: { kind: "ganger" } });
    edit("ganger@runner.example.com");
    expect(listRunners(ctx.db)[0]?.config).not.toHaveProperty("access");
  });

  test("updates the runner already pointing at this mac instead of adding another", async () => {
    const ctx = context();
    saveRunner(ctx.db, {
      id: toRunnerId("old"),
      kind: toRunnerKind("orca"),
      name: "Desk",
      config: { sshTarget: "ganger@localhost", orcaPath: "/usr/local/bin/orca", model: "x" },
      capacity: 3,
    });
    const registered = await registerThisMac(ctx, mac(fakeRunner(() => undefined).run), new Date());
    expect(registered.runnerId).toBe("old");
    const runners = listRunners(ctx.db);
    expect(runners).toHaveLength(1);
    expect(runners[0]).toMatchObject({ name: "Desk", capacity: 3 });
    expect(runners[0]?.config).toMatchObject({
      model: "x",
      orcaPath: ORCA,
      access: { kind: "ganger" },
    });
  });
});

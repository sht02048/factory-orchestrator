import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry } from "@ganger/core";
import { SecretBox, listRunners, migrate, openDatabase, saveRunner } from "@ganger/db";
import { toRunnerId, toRunnerKind } from "@ganger/core";
import { OrcaRunner, parseOrcaRunnerConfig, sshArgs } from "@ganger/runner-orca";
import type { RemoteExec, RemoteResult } from "@ganger/runner-orca";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { CommandRunner } from "./commands.js";
import {
  ENROLLMENT_TTL_MS,
  RunnerEnrollments,
  hashToken,
  receiveEnrollment,
  setupScriptFor,
  startEnrollment,
} from "./enrollment.js";
import type { EnrollmentContext } from "./enrollment.js";
import { gangerSshPaths, localGangerSsh, parsePublicKey } from "./ganger-ssh.js";
import type { GangerSsh } from "./ganger-ssh.js";

const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGangerKeyForTests ganger";
const HOST_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOtherMacHostKey root@other-mac";
const ORCA = "/Applications/Orca.app/Contents/Resources/bin/orca";
const WEB_ADDRESS = "https://ganger.example.ts.net";

let root: string;
let gangerHome: string;
let clock: number;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ganger-enroll-"));
  gangerHome = join(root, "ganger");
  clock = 1_000_000;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const keygen: CommandRunner = async (_command, args) => {
  const file = args.at(-1) ?? "";
  writeFileSync(file, "PRIVATE", { mode: 0o600 });
  writeFileSync(`${file}.pub`, `${PUBLIC_KEY}\n`);
  return { exitCode: 0, stdout: "", stderr: "" };
};

function enrollments() {
  let n = 0;
  return new RunnerEnrollments({ now: () => clock, newToken: () => `token-${++n}` });
}

function context(ssh: GangerSsh | null = localGangerSsh(gangerHome, keygen)): EnrollmentContext {
  const db = openDatabase(":memory:");
  migrate(db);
  return {
    db,
    secretBox: new SecretBox(new Uint8Array(32)),
    registry: new AdapterRegistry(),
    enrollments: enrollments(),
    ssh,
  };
}

function ready(token: string, overrides: Record<string, string> = {}) {
  return {
    token,
    outcome: "ready",
    name: "Studio Mac",
    host: "studio-mac.example.ts.net",
    account: "dev",
    hostKey: HOST_KEY,
    orcaPath: ORCA,
    github: "done",
    ...overrides,
  };
}

describe("runner enrollment tokens", () => {
  test("keeps only the token hash and hands the token out once", () => {
    const store = enrollments();
    const issued = store.issue();
    expect(issued).toMatchObject({ token: "token-1", expiresInMs: ENROLLMENT_TTL_MS });
    expect(JSON.stringify(store)).not.toContain("token-1");
    expect(hashToken("token-1")).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("refuses a token used once", () => {
    const store = enrollments();
    const { token } = store.issue();
    expect(store.claim(token)).toMatchObject({ ok: true });
    expect(store.claim(token)).toEqual({ ok: false, refusal: "used" });
    expect(store.usable(token)).toBe(false);
  });

  test("refuses a token after 10 minutes", () => {
    const store = enrollments();
    const { id, token } = store.issue();
    clock += ENROLLMENT_TTL_MS - 1;
    expect(store.usable(token)).toBe(true);
    expect(store.view(id)).toEqual({ state: "waiting", expiresInMs: 1 });
    clock += 1;
    expect(store.usable(token)).toBe(false);
    expect(store.claim(token)).toEqual({ ok: false, refusal: "expired" });
    expect(store.view(id)).toEqual({ state: "expired" });
  });

  test("refuses unknown tokens and revokes the token a new command replaces", () => {
    const store = enrollments();
    const first = store.issue();
    expect(store.claim("guess")).toEqual({ ok: false, refusal: "unknown" });
    store.revoke(first.id);
    expect(store.claim(first.token)).toEqual({ ok: false, refusal: "unknown" });
    expect(store.view(first.id)).toEqual({ state: "unknown" });
  });
});

describe("receiving a runner enrollment", () => {
  test("does nothing without a valid token", () => {
    const ctx = context();
    ctx.enrollments.issue();
    expect(receiveEnrollment(ctx, ready("guess"), new Date())).toEqual({
      status: 403,
      kind: "unknown",
    });
    expect(receiveEnrollment(ctx, { ...ready(""), token: undefined }, new Date())).toEqual({
      status: 403,
      kind: "unknown",
    });
    expect(listRunners(ctx.db)).toEqual([]);
  });

  test("refuses a command used once and one older than 10 minutes", () => {
    const ctx = context();
    const used = ctx.enrollments.issue();
    expect(receiveEnrollment(ctx, ready(used.token), new Date())).toMatchObject({ status: 200 });
    expect(receiveEnrollment(ctx, ready(used.token), new Date())).toEqual({
      status: 410,
      kind: "used",
    });
    const late = ctx.enrollments.issue();
    clock += ENROLLMENT_TTL_MS;
    expect(
      receiveEnrollment(ctx, ready(late.token, { host: "late.example.ts.net" }), new Date()),
    ).toEqual({ status: 410, kind: "expired" });
    expect(listRunners(ctx.db)).toHaveLength(1);
  });

  test("saves a Ganger-managed runner with the pinned host key, and the check reaches it", async () => {
    const ctx = context();
    const issued = ctx.enrollments.issue();
    const reply = receiveEnrollment(ctx, ready(issued.token), new Date());
    expect(reply).toEqual({ status: 200, kind: "registered", name: "Studio Mac" });

    const [stored] = listRunners(ctx.db);
    const paths = gangerSshPaths(gangerHome);
    expect(stored?.capacity).toBe(1);
    expect(stored?.config).toEqual({
      sshTarget: "dev@studio-mac.example.ts.net",
      orcaPath: ORCA,
      access: {
        kind: "ganger",
        identityFile: paths.identityFile,
        knownHostsFile: paths.knownHostsFile,
      },
    });
    expect(readFileSync(paths.knownHostsFile, "utf8")).toBe(
      "studio-mac.example.ts.net ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOtherMacHostKey\n",
    );
    expect(ctx.enrollments.view(issued.id)).toEqual({
      state: "registered",
      runner: {
        id: stored?.id,
        name: "Studio Mac",
        sshTarget: "dev@studio-mac.example.ts.net",
        orcaPath: ORCA,
        capacity: 1,
        github: "done",
      },
    });

    const config = parseOrcaRunnerConfig(stored?.config);
    expect(sshArgs(config)).toEqual([
      "-i",
      paths.identityFile,
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      `UserKnownHostsFile="${paths.knownHostsFile}"`,
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-T",
      "--",
      "dev@studio-mac.example.ts.net",
    ]);
    const health = await new OrcaRunner(config, readyOrca()).checkHealth();
    expect(health).toMatchObject({ online: true, error: null });
  });

  test("replaces an older host key for the same host instead of adding a second one", () => {
    const ctx = context();
    const paths = gangerSshPaths(gangerHome);
    const first = ctx.enrollments.issue();
    receiveEnrollment(
      ctx,
      ready(first.token, { hostKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOldKey root@x" }),
      new Date(),
    );
    const second = ctx.enrollments.issue();
    receiveEnrollment(ctx, ready(second.token), new Date());
    expect(readFileSync(paths.knownHostsFile, "utf8")).toBe(
      "studio-mac.example.ts.net ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOtherMacHostKey\n",
    );
    expect(listRunners(ctx.db)).toHaveLength(1);
  });

  test("re-enrolling a Mac keeps the runner's saved name and capacity and reports them", () => {
    const ctx = context();
    receiveEnrollment(ctx, ready(ctx.enrollments.issue().token), new Date());
    const [first] = listRunners(ctx.db);
    saveRunner(ctx.db, {
      id: first?.id ?? toRunnerId("x"),
      kind: toRunnerKind("orca"),
      name: "Desk",
      config: first?.config ?? {},
      capacity: 3,
    });
    const again = ctx.enrollments.issue();
    expect(receiveEnrollment(ctx, ready(again.token), new Date())).toEqual({
      status: 200,
      kind: "registered",
      name: "Desk",
    });
    expect(ctx.enrollments.view(again.id)).toMatchObject({
      state: "registered",
      runner: { name: "Desk", capacity: 3 },
    });
    expect(listRunners(ctx.db)).toHaveLength(1);
  });

  test("records a failure the setup script reports and uses up the token", () => {
    const ctx = context();
    const issued = ctx.enrollments.issue();
    const reply = receiveEnrollment(
      ctx,
      {
        token: issued.token,
        outcome: "failed",
        problem: "service-failed",
        detail: "launchctl:\n  bootstrap failed",
      },
      new Date(),
    );
    expect(reply).toEqual({ status: 200, kind: "failure-recorded" });
    expect(ctx.enrollments.view(issued.id)).toEqual({
      state: "failed",
      problem: "service-failed",
      detail: "launchctl: bootstrap failed",
    });
    expect(receiveEnrollment(ctx, ready(issued.token), new Date())).toMatchObject({
      status: 410,
    });
  });

  test("rejects reports whose values could break the ssh target or the runner config", () => {
    for (const bad of [
      { host: "-oProxyCommand=x" },
      { host: "evil host" },
      { account: "dev@x" },
      { orcaPath: 'bin/orca"' },
      { orcaPath: "relative/orca" },
      { hostKey: "not a key" },
    ]) {
      const ctx = context();
      const issued = ctx.enrollments.issue();
      expect(receiveEnrollment(ctx, ready(issued.token, bad), new Date())).toEqual({
        status: 400,
        kind: "invalid-report",
      });
      expect(listRunners(ctx.db)).toEqual([]);
    }
  });
});

describe("starting an enrollment", () => {
  test("needs the address other devices use to reach this server", async () => {
    const ctx = context();
    expect(
      await startEnrollment({ enrollments: ctx.enrollments, ssh: ctx.ssh, webAddress: null }),
    ).toEqual({ ok: false, reason: "no-web-address" });
    expect(
      await startEnrollment({ enrollments: ctx.enrollments, ssh: null, webAddress: WEB_ADDRESS }),
    ).toEqual({ ok: false, reason: "no-home" });
    expect(
      await startEnrollment({
        enrollments: ctx.enrollments,
        ssh: ctx.ssh,
        webAddress: "not a url",
      }),
    ).toEqual({ ok: false, reason: "no-web-address" });
    expect(ctx.enrollments.claim("token-1")).toEqual({ ok: false, refusal: "unknown" });
  });

  test("gives a one-line command for the other Mac and serves the script only for a live token", async () => {
    const ctx = context();
    const started = await startEnrollment({
      enrollments: ctx.enrollments,
      ssh: ctx.ssh,
      webAddress: `${WEB_ADDRESS}/`,
    });
    expect(started.ok && typeof started.id).toBe("string");
    expect(started).toMatchObject({
      ok: true,
      expiresInMs: ENROLLMENT_TTL_MS,
      command: `curl -fsSL '${WEB_ADDRESS}/api/runner-enrollment/script?t=token-1' | sh`,
      reviewCommand:
        `curl -fsSL '${WEB_ADDRESS}/api/runner-enrollment/script?t=token-1' -o ganger-runner-setup.sh` +
        " && less ganger-runner-setup.sh && sh ganger-runner-setup.sh",
      scriptPath: "/api/runner-enrollment/script?t=token-1",
    });
    const request = { enrollments: ctx.enrollments, ssh: ctx.ssh, webAddress: WEB_ADDRESS };
    const script = await setupScriptFor({ ...request, token: "token-1" });
    expect(script).toContain(`GANGER_URL='${WEB_ADDRESS}'`);
    expect(script).toContain(`GANGER_KEY='${PUBLIC_KEY}'`);
    expect(await setupScriptFor({ ...request, token: "guess" })).toBeNull();
    expect(await setupScriptFor({ ...request, token: null })).toBeNull();

    const replaced = await startEnrollment({
      ...request,
      replacing: started.ok ? started.id : undefined,
    });
    expect(replaced).toMatchObject({ ok: true });
    expect(await setupScriptFor({ ...request, token: "token-1" })).toBeNull();
    expect(ctx.enrollments.claim("token-1")).toEqual({ ok: false, refusal: "unknown" });
  });
});

test("parses the host key line the setup script sends", () => {
  expect(parsePublicKey(HOST_KEY)).toEqual({
    type: "ssh-ed25519",
    body: "AAAAC3NzaC1lZDI1NTE5AAAAIOtherMacHostKey",
  });
});

function readyOrca(): RemoteExec {
  const ok = (stdout: string): RemoteResult => ({
    exitCode: 0,
    stdout,
    stderr: "",
    timedOut: false,
  });
  return {
    async run(command) {
      if (command.includes(" status")) {
        return ok(
          JSON.stringify({
            ok: true,
            result: { runtime: { reachable: true, state: "ready", appVersion: "1.4.253" } },
          }),
        );
      }
      if (command.includes("serve service status")) {
        return ok(JSON.stringify({ ok: true, result: { installed: true, running: true } }));
      }
      if (command.includes("project list")) {
        return ok(JSON.stringify({ ok: true, result: { projects: [] } }));
      }
      if (command.includes("project setups")) {
        return ok(JSON.stringify({ ok: true, result: { setups: [] } }));
      }
      return { exitCode: 1, stdout: "", stderr: `unexpected ${command}`, timedOut: false };
    },
  };
}

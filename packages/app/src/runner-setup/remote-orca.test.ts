import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry } from "@ganger/core";
import { SecretBox, listRunners, migrate, openDatabase } from "@ganger/db";
import type { RemoteExec, RemoteResult } from "@ganger/runner-orca";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { findOrcaCommand, findOrcaOverSsh, saveRunnerFindingOrca } from "./remote-orca.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ganger-remote-orca-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function executable(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

function localExec(env: Record<string, string>, defaultOrcaPath: string): RemoteExec {
  return {
    async run() {
      const result = spawnSync("/bin/sh", ["-c", findOrcaCommand(defaultOrcaPath)], {
        encoding: "utf8",
        env,
      });
      return {
        exitCode: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: false,
      };
    },
  };
}

function reply(result: Partial<RemoteResult>): RemoteExec {
  return {
    async run() {
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false, ...result };
    },
  };
}

describe("finding orca on the runner over ssh", () => {
  test("prefers the Orca app path, then the login shell's orca", async () => {
    const appOrca = join(root, "orca-app");
    executable(appOrca, "exit 0");
    const shell = join(root, "login-shell");
    executable(shell, `printf '/opt/homebrew/bin/orca\\n'`);
    const command = (defaultPath: string) =>
      spawnSync("/bin/sh", ["-c", findOrcaCommand(defaultPath)], {
        encoding: "utf8",
        env: { SHELL: shell, PATH: "/usr/bin:/bin" },
      }).stdout;
    expect(command(appOrca)).toBe(`${appOrca}\n`);
    expect(command(join(root, "missing"))).toBe("/opt/homebrew/bin/orca\n");
  });

  test("says orca is missing when the login shell cannot find it", async () => {
    const shell = join(root, "login-shell");
    executable(shell, "exit 1");
    expect(
      await findOrcaOverSsh(localExec({ SHELL: shell, PATH: "/usr/bin:/bin" }, join(root, "x"))),
    ).toEqual({ ok: false, reason: "orca-not-found" });
  });

  test("tells an ssh failure apart from a missing orca", async () => {
    expect(await findOrcaOverSsh(reply({ exitCode: 255 }))).toEqual({
      ok: false,
      reason: "ssh-failed",
    });
    expect(await findOrcaOverSsh(reply({ timedOut: true, exitCode: null }))).toEqual({
      ok: false,
      reason: "ssh-failed",
    });
    expect(await findOrcaOverSsh(reply({ stdout: "orca not found\n" }))).toEqual({
      ok: false,
      reason: "orca-not-found",
    });
  });
});

describe("saving a directly entered runner with an empty orca path", () => {
  function context() {
    const db = openDatabase(":memory:");
    migrate(db);
    return { db, secretBox: new SecretBox(new Uint8Array(32)), registry: new AdapterRegistry() };
  }
  const input = { name: "mini", sshTarget: "dev@mini.example.com", orcaPath: "", capacity: 1 };

  test("fills the orca path found on that Mac", async () => {
    const ctx = context();
    const targets: string[] = [];
    const saved = await saveRunnerFindingOrca(ctx, input, new Date(), (target) => {
      targets.push(target);
      return reply({ stdout: "Last login: today\n/usr/local/bin/orca\n" });
    });
    expect(saved).toMatchObject({ ok: true });
    expect(targets).toEqual(["dev@mini.example.com"]);
    expect(listRunners(ctx.db)[0]?.config).toEqual({
      sshTarget: "dev@mini.example.com",
      orcaPath: "/usr/local/bin/orca",
    });
  });

  test("saves nothing when orca cannot be found", async () => {
    const ctx = context();
    const saved = await saveRunnerFindingOrca(ctx, input, new Date(), () => reply({ exitCode: 1 }));
    expect(saved).toEqual({ ok: false, reason: "orca-not-found" });
    expect(listRunners(ctx.db)).toEqual([]);
  });

  test("does not touch ssh when the orca path is given", async () => {
    const ctx = context();
    const saved = await saveRunnerFindingOrca(
      ctx,
      { ...input, orcaPath: "/opt/orca" },
      new Date(),
      () => {
        throw new Error("ssh should not run");
      },
    );
    expect(saved).toMatchObject({ ok: true });
  });
});

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { choosePushRemote, classifyPush, mapWithConcurrency, redactReason } from "./push-check.js";
import type { RemoteExec, RemoteResult } from "./ssh.js";
import { parseOrcaRunnerConfig } from "./config.js";
import { OrcaRunner } from "./orca-runner.js";
import { ScriptedExec, own, stdout } from "./test-support.js";

function failed(stderr: string, exitCode = 128): RemoteResult {
  return { exitCode, stdout: "", stderr, timedOut: false };
}

describe("choosePushRemote", () => {
  test("uses remote.pushDefault first", () => {
    const config = [
      "remote.pushdefault mine",
      "remote.origin.url https://github.com/acme/x.git",
      "remote.mine.url https://github.com/me/x.git",
    ].join("\n");
    expect(choosePushRemote(config, "upstream")).toBe("mine");
  });

  test("uses origin when it exists, even if the project names another remote", () => {
    const config = [
      "remote.origin.url https://github.com/me/x.git",
      "remote.upstream.url https://github.com/acme/x.git",
    ].join("\n");
    expect(choosePushRemote(config, "upstream")).toBe("origin");
  });

  test("falls back to the project's remote without origin", () => {
    expect(choosePushRemote("remote.github.url git@github.com:acme/x.git\n", "github")).toBe(
      "github",
    );
    expect(choosePushRemote("", "upstream")).toBe("upstream");
  });
});

describe("classifyPush", () => {
  test("passes on exit 0", () => {
    expect(classifyPush(failed("", 0), [])).toEqual({ satisfied: true });
  });

  test.each([
    ["remote: Permission to acme/x.git denied to someone.", "auth"],
    ["fatal: Authentication failed for 'https://github.com/acme/x.git/'", "auth"],
    ["git@github.com: Permission denied (publickey).", "auth"],
    ["ERROR: Repository not found.", "auth"],
    [
      "fatal: unable to access 'https://github.com/acme/x.git/': Could not resolve host: github.com",
      "network",
    ],
    ["ssh: connect to host github.com port 22: Connection refused", "network"],
    ["fatal: 'upstream' does not appear to be a git repository", "other"],
  ])("sorts %s as %s", (line, kind) => {
    const outcome = classifyPush(failed(`${line}\n`), []);
    expect(outcome).toMatchObject({ satisfied: false, failure: { kind } });
  });

  test("picks the meaningful line past ssh warnings", () => {
    const outcome = classifyPush(
      failed(
        "Warning: Permanently added 'github.com' to the list of known hosts.\nremote: Permission to acme/x.git denied to someone.\nfatal: unable to access 'https://github.com/acme/x.git/': The requested URL returned error: 403\n",
      ),
      [],
    );
    expect(outcome).toEqual({
      satisfied: false,
      failure: { kind: "auth", reason: "Permission to acme/x.git denied to someone." },
    });
  });

  test("a timeout or an ssh exit is unknown, not broken", () => {
    expect(classifyPush({ exitCode: null, stdout: "", stderr: "", timedOut: true }, [])).toEqual({
      satisfied: null,
      failure: { kind: "timeout", reason: null },
    });
    expect(
      classifyPush(failed("ssh: connect to host runner port 22: Operation timed out", 255), []),
    ).toMatchObject({
      satisfied: null,
      failure: { kind: "network" },
    });
  });
});

describe("redactReason", () => {
  test("hides tokens, credentials in URLs and local paths", () => {
    expect(
      redactReason(
        "fatal: unable to access 'https://someone:ghp_abcdefghijklmnop@github.com/acme/x.git/': 403",
        [],
      ),
    ).toBe("fatal: unable to access 'https://<redacted>@github.com/acme/x.git/': 403");
    expect(redactReason("error: github_pat_11ABCDEFG0123456789_xyz is bad", [])).toBe(
      "error: <token> is bad",
    );
    expect(redactReason("fatal: cannot change to '/home/someone/repos/x': No such file", [])).toBe(
      "fatal: cannot change to '<path>': No such file",
    );
    expect(redactReason("fatal: not a git repository: /srv/x/.git", ["/srv/x"])).toBe(
      "fatal: not a git repository: <repo>/.git",
    );
  });

  test("cuts long lines", () => {
    expect(redactReason("x".repeat(500), []).length).toBe(200);
  });
});

describe("mapWithConcurrency", () => {
  test("keeps order and never runs more than the limit at once", async () => {
    let running = 0;
    let most = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return n * 10;
    });
    expect(result).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(most).toBe(3);
  });
});

class LocalGitExec implements RemoteExec {
  constructor(private readonly orca: ScriptedExec) {}

  run(command: string, options: { stdin?: string; timeoutMs: number }): Promise<RemoteResult> {
    if (!command.startsWith("git ") && !command.startsWith("env ")) {
      return this.orca.run(command, options);
    }
    return new Promise((resolve) => {
      const child = spawn("sh", ["-c", command]);
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
      child.on("close", (code) =>
        resolve({ exitCode: code, stdout: out, stderr: err, timedOut: false }),
      );
    });
  }
}

describe("push check on a real fork clone", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
  }

  test("passes through origin although the project's remote is an unwritable upstream", async () => {
    const root = mkdtempSync(join(tmpdir(), "ganger-push-check-"));
    dirs.push(root);
    const fork = join(root, "fork.git");
    const clone = join(root, "sandbox");
    git(root, "init", "--bare", "--quiet", fork);
    git(root, "init", "--quiet", clone);
    git(
      clone,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "init",
    );
    git(clone, "remote", "add", "origin", fork);
    git(clone, "remote", "add", "upstream", join(root, "missing-upstream.git"));

    const setups = own("project-setups.json").replace('"<path>/sandbox"', JSON.stringify(clone));
    const upstreamList = own("project-list.json").replace(
      '"remoteName": "origin"',
      '"remoteName": "upstream"',
    );
    const orca = new ScriptedExec()
      .orca("status", stdout(own("status-ready.json")))
      .orca("serve service status", stdout(own("serve-service-status-live.json")))
      .orca("project list", stdout(upstreamList))
      .orca("project setups", stdout(setups));
    const runner = new OrcaRunner(
      parseOrcaRunnerConfig({ sshTarget: "runner.example.com" }),
      new LocalGitExec(orca),
      { sleep: () => Promise.resolve() },
    );

    const health = await runner.checkHealth();
    expect(health.prerequisites[1]).toMatchObject({ satisfied: true });

    git(clone, "remote", "remove", "origin");
    const without = await runner.checkHealth();
    const broken = without.prerequisites[1];
    expect(broken).toMatchObject({ satisfied: false, failure: { kind: "other" } });
    expect(broken?.failure?.reason).toMatch(
      /^fatal: '<path>' does not appear to be a git repository$/,
    );
  });
});

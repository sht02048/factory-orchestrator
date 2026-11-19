import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serviceInstallArgs } from "@ganger/runner-orca";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { PROGRESS_ENV, renderSetupScript, setupCommand, shellLiteral } from "./setup-script.js";
import type { SetupScriptInput } from "./setup-script.js";

const TOKEN = "tok_Abc-123_xyz";
const GH_TOKEN = "gho_secretTokenValue123";
const KEY = { type: "ssh-ed25519", body: "AAAAC3NzaC1lZDI1NTE5AAAAIGangerKeyForTests" };
const HOST_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOtherMacHostKey root@other-mac";

let root: string;
let home: string;
let bin: string;
let log: string;
let orca: string;
let hostKeyFile: string;
let system: string;

const SYSTEM_TOOLS = [
  "cat",
  "chmod",
  "grep",
  "head",
  "hostname",
  "id",
  "ls",
  "mkdir",
  "mktemp",
  "rm",
  "tail",
  "tr",
];

function stub(name: string, body: string): void {
  const file = join(bin, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ganger-setup-script-"));
  home = join(root, "home");
  bin = join(root, "bin");
  log = join(root, "log");
  orca = join(root, "Orca.app", "orca");
  hostKeyFile = join(root, "ssh_host_ed25519_key.pub");
  system = join(root, "system");
  for (const dir of [home, bin, log, system, join(root, "Orca.app")]) {
    mkdirSync(dir, { recursive: true });
  }
  for (const tool of SYSTEM_TOOLS) {
    const found = spawnSync("/bin/sh", ["-c", `command -v ${tool}`], { encoding: "utf8" });
    const path = found.stdout.trim();
    if (found.status === 0 && path.startsWith("/")) symlinkSync(path, join(system, tool));
  }
  writeFileSync(hostKeyFile, `${HOST_KEY}\n`);
  writeFileSync(orca, `#!/bin/sh\nprintf '%s\\n' "$*" >>"${log}/orca"\n`);
  chmodSync(orca, 0o755);
  stub("nc", "exit 0");
  stub("open", `printf '%s\\n' "$*" >>"${log}/open"`);
  stub("sleep", "exit 0");
  stub("scutil", "printf 'Studio Mac\\n'");
  stub(
    "tailscale",
    `[ "$1" = status ] && printf '{"Self":{"DNSName":"studio-mac.example.ts.net."}}'`,
  );
  stub("plutil", "cat >/dev/null; printf 'studio-mac.example.ts.net.'");
  stub(
    "curl",
    [
      `n=$(ls "${log}" | grep -c '^curl-args-' || true)`,
      `printf '%s\\n' "$@" >"${log}/curl-args-$n"`,
      `cat >"${log}/curl-stdin-$n"`,
      `printf 'Ganger: registered\\n'`,
    ].join("\n"),
  );
  stub(
    "gh",
    [
      `printf '%s\\n' "$*" >>"${log}/gh"`,
      `case "$1 $2" in`,
      `  "auth token") printf '${GH_TOKEN}\\n' ;;`,
      `  "auth login") cat >"${log}/gh-login-stdin" ;;`,
      `esac`,
    ].join("\n"),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(overrides: Partial<SetupScriptInput> = {}, env: Record<string, string> = {}) {
  const script = renderSetupScript({
    serverUrl: "https://ganger.example.ts.net/",
    token: TOKEN,
    publicKey: KEY,
    defaultOrcaPath: orca,
    hostKeyFile,
    remoteLoginTries: 2,
    ghCandidates: [],
    tailscaleApp: join(root, "no-tailscale-app"),
    ...overrides,
  });
  const result = spawnSync("/bin/sh", ["-s"], {
    input: script,
    encoding: "utf8",
    env: { HOME: home, PATH: `${bin}:${system}`, ...env },
  });
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

function curlCall(n: number): { args: string[]; stdin: string } {
  return {
    args: readFileSync(join(log, `curl-args-${n}`), "utf8")
      .trimEnd()
      .split("\n"),
    stdin: readFileSync(join(log, `curl-stdin-${n}`), "utf8"),
  };
}

const mode = (path: string) => statSync(path).mode & 0o777;

describe("setup script for another Mac", () => {
  test("adds the Ganger key, installs the Orca service, sets up GitHub and sends the Mac's details", () => {
    const result = run();
    expect(result.status).toBe(0);
    const authorized = join(home, ".ssh", "authorized_keys");
    expect(readFileSync(authorized, "utf8")).toBe(`ssh-ed25519 ${KEY.body} ganger\n`);
    expect(mode(join(home, ".ssh"))).toBe(0o700);
    expect(mode(authorized)).toBe(0o600);
    expect(readFileSync(join(log, "orca"), "utf8")).toBe(
      `${serviceInstallArgs(orca).slice(1).join(" ")}\n`,
    );
    expect(readFileSync(join(log, "gh-login-stdin"), "utf8")).toBe(`${GH_TOKEN}\n`);

    const report = curlCall(0);
    expect(report.stdin).toBe(TOKEN);
    expect(report.args).toEqual([
      "-sS",
      "--fail-with-body",
      "-X",
      "POST",
      "https://ganger.example.ts.net/api/runner-enrollment",
      "--data-urlencode",
      "token@-",
      "--data-urlencode",
      "outcome=ready",
      "--data-urlencode",
      "name=Studio Mac",
      "--data-urlencode",
      "host=studio-mac.example.ts.net",
      "--data-urlencode",
      `account=${spawnSync("id", ["-un"], { encoding: "utf8" }).stdout.trim()}`,
      "--data-urlencode",
      `hostKey=${HOST_KEY}`,
      "--data-urlencode",
      `orcaPath=${orca}`,
      "--data-urlencode",
      "github=done",
    ]);
    expect(result.output).not.toContain(TOKEN);
    expect(result.output).not.toContain(GH_TOKEN);
    expect(report.args.join(" ")).not.toContain(GH_TOKEN);
  });

  test("keeps existing keys and does not add the Ganger key twice", () => {
    mkdirSync(join(home, ".ssh"), { mode: 0o755 });
    writeFileSync(join(home, ".ssh", "authorized_keys"), "ssh-rsa AAAAB3Other me@laptop", {
      mode: 0o644,
    });
    expect(run().status).toBe(0);
    expect(run().status).toBe(0);
    const authorized = join(home, ".ssh", "authorized_keys");
    expect(readFileSync(authorized, "utf8")).toBe(
      `ssh-rsa AAAAB3Other me@laptop\nssh-ed25519 ${KEY.body} ganger\n`,
    );
    expect(mode(join(home, ".ssh"))).toBe(0o700);
    expect(mode(authorized)).toBe(0o600);
  });

  test("reports a missing Orca before changing anything", () => {
    rmSync(orca);
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain("Could not find Orca");
    expect(existsSync(join(home, ".ssh"))).toBe(false);
    const report = curlCall(0);
    expect(report.stdin).toBe(TOKEN);
    expect(report.args).toContain("outcome=failed");
    expect(report.args).toContain("problem=orca-not-found");
  });

  test("opens Sharing settings and gives up when Remote Login stays off", () => {
    stub("nc", "exit 1");
    const result = run();
    expect(result.status).toBe(1);
    expect(readFileSync(join(log, "open"), "utf8")).toContain(
      "x-apple.systempreferences:com.apple.preferences.sharing",
    );
    expect(curlCall(0).args).toContain("problem=remote-login-off");
  });

  test("reports the service install error with its last lines", () => {
    writeFileSync(orca, `#!/bin/sh\nprintf 'launchctl bootstrap failed\\n' >&2\nexit 3\n`);
    const result = run();
    expect(result.status).toBe(1);
    const report = curlCall(0);
    expect(report.args).toContain("problem=service-failed");
    expect(report.args.find((arg) => arg.startsWith("detail="))?.trim()).toBe(
      "detail=launchctl bootstrap failed",
    );
  });

  test("skips GitHub when gh is missing and says so to the server", () => {
    rmSync(join(bin, "gh"));
    expect(run().status).toBe(0);
    expect(curlCall(0).args).toContain("github=gh-missing");
  });

  test("falls back to the tailnet IP when the DNS name is missing", () => {
    stub("plutil", "cat >/dev/null; exit 1");
    stub("tailscale", `[ "$1" = ip ] && printf '100.64.0.7\\n'`);
    expect(run().status).toBe(0);
    expect(curlCall(0).args).toContain("host=100.64.0.7");
  });

  test("fails clearly without Tailscale", () => {
    rmSync(join(bin, "tailscale"));
    const result = run();
    expect(result.status).toBe(1);
    expect(curlCall(0).args).toContain("problem=tailscale-missing");
  });
});

const progressLines = (stdout: string) =>
  stdout.split("\n").filter((line) => line.startsWith("ganger-"));

describe("progress lines for the Ganger app", () => {
  test("prints no progress lines for the terminal command", () => {
    expect(progressLines(run().stdout)).toEqual([]);
  });

  test("prints each step without the token or the gh token", () => {
    const result = run({}, { [PROGRESS_ENV]: "1" });
    expect(result.status).toBe(0);
    expect(progressLines(result.stdout)).toEqual([
      "ganger-step:remote-login",
      "ganger-step:key",
      "ganger-step:service",
      "ganger-github:done",
      "ganger-step:github",
      "ganger-step:report",
    ]);
    expect(result.output).not.toContain(TOKEN);
    expect(result.output).not.toContain(GH_TOKEN);
  });

  test("says it waits for Remote Login and names the problem when it gives up", () => {
    stub("nc", "exit 1");
    const result = run({}, { [PROGRESS_ENV]: "1" });
    expect(progressLines(result.stdout)).toEqual([
      "ganger-step:remote-login-wait",
      "ganger-fail:remote-login-off",
    ]);
  });

  test("names a server refusal and an unreachable server apart", () => {
    stub("curl", "cat >/dev/null; exit 22");
    expect(progressLines(run({}, { [PROGRESS_ENV]: "1" }).stdout).at(-1)).toBe(
      "ganger-fail:refused",
    );
    stub("curl", "cat >/dev/null; exit 7");
    expect(progressLines(run({}, { [PROGRESS_ENV]: "1" }).stdout).at(-1)).toBe(
      "ganger-fail:unreachable",
    );
  });

  test("reports canceled to the server when stopped while waiting", () => {
    stub("nc", "exit 1");
    stub("sleep", "kill -TERM $PPID");
    const result = run({}, { [PROGRESS_ENV]: "1" });
    expect(result.status).toBe(130);
    expect(progressLines(result.stdout)).toEqual([
      "ganger-step:remote-login-wait",
      "ganger-fail:canceled",
    ]);
    const report = curlCall(0);
    expect(report.stdin).toBe(TOKEN);
    expect(report.args).toContain("problem=canceled");
    expect(existsSync(join(log, "curl-args-1"))).toBe(false);
  });
});

describe("stopping while the result is being sent", () => {
  test("lets the report to the server finish instead of dying half way", () => {
    stub(
      "curl",
      [
        `cat >"${log}/curl-stdin-0"`,
        "kill -TERM $PPID",
        "kill -TERM $$",
        "printf 'Ganger: registered\\n'",
      ].join("\n"),
    );
    const result = run({}, { [PROGRESS_ENV]: "1" });
    expect(result.status).toBe(0);
    expect(progressLines(result.stdout).at(-1)).toBe("ganger-step:report");
    expect(result.stdout).toContain("Ganger: registered");
  });
});

describe("shell quoting for values put into the script", () => {
  const nasty = [
    "plain",
    "it's",
    "$(touch pwned)",
    "`id`",
    'quote " and \\ backslash',
    "line\nbreak",
    "'; rm -rf / #",
    "",
  ];

  test.each(nasty)("keeps %j exactly as given", (value) => {
    const result = spawnSync("/bin/sh", ["-c", `v=${shellLiteral(value)}; printf '%s' "$v"`], {
      encoding: "utf8",
      cwd: root,
    });
    expect(result.stdout).toBe(value);
    expect(existsSync(join(root, "pwned"))).toBe(false);
  });

  test("a hostile server address and token stay inert in the script and the command", () => {
    const serverUrl = "https://ganger.example.ts.net/'$(touch pwned)'";
    const token = "x'$(touch pwned)'";
    const script = renderSetupScript({ serverUrl, token, publicKey: KEY });
    const check = spawnSync("/bin/sh", ["-n"], { input: script, encoding: "utf8" });
    expect(check.status).toBe(0);
    const values = spawnSync(
      "/bin/sh",
      ["-c", `${script.split("\nsay()")[0] ?? ""}\nprintf '%s|%s' "$GANGER_URL" "$GANGER_TOKEN"`],
      { encoding: "utf8", cwd: root },
    );
    expect(values.stdout).toBe(`${serverUrl}|${token}`);
    const echo = spawnSync(
      "/bin/sh",
      [
        "-c",
        setupCommand(serverUrl)
          .replace(/^curl -fsSL /u, "printf '%s' ")
          .replace(/ \| sh$/u, ""),
      ],
      {
        encoding: "utf8",
        cwd: root,
      },
    );
    expect(echo.stdout).toBe(serverUrl);
    expect(existsSync(join(root, "pwned"))).toBe(false);
  });
});

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { homePaths } from "./home.js";
import type { AppLayout } from "./layout.js";
import { runProgram } from "./program.js";
import type { ProgramContext } from "./program.js";

let dir: string;
let out: string[];
let err: string[];
let ran: string[][];

const unusedLayout: AppLayout = {
  web: () => {
    throw new Error("not used");
  },
  worker: () => {
    throw new Error("not used");
  },
};

function context(overrides: Partial<ProgramContext> = {}): ProgramContext {
  return {
    env: { PATH: "/usr/bin:/bin" },
    platform: "darwin",
    userHome: dir,
    uid: 501,
    nodePath: "/opt/node/bin/node",
    cliEntry: "/opt/factory-orchestrator/dist/bin/cli.js",
    layout: unusedLayout,
    runCommand: (command) => {
      ran.push([...command]);
      return { ok: true };
    },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    onStopSignal: () => undefined,
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-cli-program-"));
  out = [];
  err = [];
  ran = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runProgram", () => {
  it("init은 기본 home에 .env를 만들고, 다시 돌리면 그대로 둔다고 알린다", async () => {
    expect(await runProgram(["init"], context())).toBe(0);
    const envFile = homePaths(join(dir, ".factory-orchestrator")).envFile;
    expect(existsSync(envFile)).toBe(true);
    expect(out.join("\n")).toContain(`Wrote boot settings to ${envFile}`);

    out = [];
    expect(await runProgram(["init"], context())).toBe(0);
    expect(out.join("\n")).toContain("Left them unchanged, including the encryption key");
  });

  it("service install --dry-run은 보여 주기만 하고 아무것도 쓰거나 돌리지 않는다", async () => {
    const home = join(dir, "home");
    expect(await runProgram(["service", "install", "--dry-run", "--home", home], context())).toBe(
      0,
    );
    const printed = out.join("\n");
    const plist = join(dir, "Library", "LaunchAgents", "factory-orchestrator.plist");
    expect(printed).toContain(`Would write ${plist}:`);
    expect(printed).toContain("<string>start</string>");
    expect(printed).toContain(`launchctl bootstrap gui/501 ${plist}`);
    expect(existsSync(plist)).toBe(false);
    expect(existsSync(join(home, "logs"))).toBe(false);
    expect(ran).toEqual([]);
  });

  it("service uninstall --dry-run은 멈출 명령과 지울 파일만 보여 준다", async () => {
    const ctx = context({ platform: "linux", env: { PATH: "/usr/bin" } });
    expect(await runProgram(["service", "uninstall", "--dry-run"], ctx)).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain("systemctl --user disable --now factory-orchestrator.service");
    expect(printed).toContain(
      `Would remove ${join(dir, ".config", "systemd", "user", "factory-orchestrator.service")}`,
    );
    expect(ran).toEqual([]);
  });

  it("init 전에는 서비스를 등록하지 않는다", async () => {
    expect(await runProgram(["service", "install"], context())).toBe(1);
    expect(err.join("\n")).toContain("Run `factory-orchestrator init` before installing");
    expect(existsSync(join(dir, "Library"))).toBe(false);
    expect(ran).toEqual([]);
  });

  it("init 뒤에 등록하고 해제한다", async () => {
    await runProgram(["init"], context());
    expect(await runProgram(["service", "install"], context())).toBe(0);
    const plist = join(dir, "Library", "LaunchAgents", "factory-orchestrator.plist");
    expect(existsSync(plist)).toBe(true);
    expect(await runProgram(["service", "uninstall"], context())).toBe(0);
    expect(existsSync(plist)).toBe(false);
    expect(ran).toEqual([
      ["launchctl", "bootstrap", "gui/501", plist],
      ["launchctl", "bootout", "gui/501/factory-orchestrator"],
    ]);
  });

  it("지원하지 않는 OS에서는 서비스를 등록하지 않는다", async () => {
    expect(await runProgram(["service", "install"], context({ platform: "win32" }))).toBe(1);
    expect(err.join("\n")).toContain("not win32");
  });

  it("모르는 명령이면 사용법을 보이고 2로 끝낸다", async () => {
    expect(await runProgram(["serve"], context())).toBe(2);
    expect(err.join("\n")).toContain("Unknown command: serve");
    expect(await runProgram(["--help"], context())).toBe(0);
    expect(out.join("\n")).toContain("Usage: factory-orchestrator");
  });

  it("start는 .env가 없으면 init을 먼저 하라고 알린다", async () => {
    expect(await runProgram(["start", "--home", join(dir, "none")], context())).toBe(1);
    expect(err.join("\n")).toContain("Run `factory-orchestrator init` first");
  });
});

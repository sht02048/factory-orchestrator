import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { homePaths } from "./home.js";
import type { AppLayout, ProcessSpec } from "./layout.js";
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
    cliEntry: "/opt/ganger/dist/bin/cli.js",
    layout: unusedLayout,
    runCommand: (command) => {
      ran.push([...command]);
      return { ok: true };
    },
    holdSleepAssertion: () => ({ exited: new Promise(() => undefined), release: () => undefined }),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    onStopSignal: () => undefined,
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ganger-cli-program-"));
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
    const envFile = homePaths(join(dir, ".ganger")).envFile;
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
    const plist = join(dir, "Library", "LaunchAgents", "ganger.plist");
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
    expect(printed).toContain("systemctl --user disable --now ganger.service");
    expect(printed).toContain(
      `Would remove ${join(dir, ".config", "systemd", "user", "ganger.service")}`,
    );
    expect(ran).toEqual([]);
  });

  it("init 전에는 서비스를 등록하지 않는다", async () => {
    expect(await runProgram(["service", "install"], context())).toBe(1);
    expect(err.join("\n")).toContain("Run `ganger init` before installing");
    expect(existsSync(join(dir, "Library"))).toBe(false);
    expect(ran).toEqual([]);
  });

  it("init 뒤에 등록하고 해제한다", async () => {
    await runProgram(["init"], context());
    expect(await runProgram(["service", "install"], context())).toBe(0);
    const plist = join(dir, "Library", "LaunchAgents", "ganger.plist");
    expect(existsSync(plist)).toBe(true);
    expect(await runProgram(["service", "uninstall"], context())).toBe(0);
    expect(existsSync(plist)).toBe(false);
    expect(ran).toEqual([
      ["launchctl", "bootstrap", "gui/501", plist],
      ["launchctl", "bootout", "gui/501/ganger"],
    ]);
  });

  it("해제할 때 멈추는 명령이 실패하면 파일은 지우되 1로 끝낸다", async () => {
    await runProgram(["init"], context());
    await runProgram(["service", "install"], context());
    const failing = context({ runCommand: () => ({ ok: false, output: "Boot-out failed: 5" }) });
    expect(await runProgram(["service", "uninstall"], failing)).toBe(1);
    expect(err.join("\n")).toContain("stopping the service failed");
    expect(existsSync(join(dir, "Library", "LaunchAgents", "ganger.plist"))).toBe(false);
  });

  it("명령에 맞지 않는 옵션은 무시하지 않고 2로 끝낸다", async () => {
    expect(await runProgram(["start", "--port", "4000"], context())).toBe(2);
    expect(err.join("\n")).toContain("--port cannot be used with start");
    expect(await runProgram(["init", "--dry-run"], context())).toBe(2);
    expect(existsSync(join(dir, ".ganger"))).toBe(false);
  });

  it("지원하지 않는 OS에서는 서비스를 등록하지 않는다", async () => {
    expect(await runProgram(["service", "install"], context({ platform: "win32" }))).toBe(1);
    expect(err.join("\n")).toContain("not win32");
  });

  it("모르는 명령이면 사용법을 보이고 2로 끝낸다", async () => {
    expect(await runProgram(["serve"], context())).toBe(2);
    expect(err.join("\n")).toContain("Unknown command: serve");
    expect(await runProgram(["--help"], context())).toBe(0);
    expect(out.join("\n")).toContain("Usage: ganger");
  });

  it("start는 서버가 도는 동안 이 프로세스 pid로 잠자기 방지를 걸고, 멈추면 푼다", async () => {
    const port = await new Promise<number>((resolve) => {
      const probe = createServer();
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        probe.close(() =>
          resolve(typeof address === "object" && address !== null ? address.port : 0),
        );
      });
    });
    const home = join(dir, "home");
    expect(await runProgram(["init", "--home", home, "--port", String(port)], context())).toBe(0);
    const script = (name: ProcessSpec["name"], source: string): ProcessSpec => {
      const file = join(dir, `${name}.mjs`);
      writeFileSync(file, source);
      return { name, command: process.execPath, args: [file], cwd: dir, requires: [file] };
    };
    const layout: AppLayout = {
      web: () =>
        script(
          "web",
          `import { createServer } from "node:http";
const server = createServer((_req, res) => res.end("ok"));
server.listen(Number(process.env.WEB_PORT), process.env.WEB_HOST);
process.on("SIGTERM", () => server.close(() => process.exit(0)));`,
        ),
      worker: () =>
        script(
          "worker",
          `const timer = setInterval(() => undefined, 1000);
process.on("SIGTERM", () => { clearInterval(timer); process.exit(0); });`,
        ),
    };
    const assertions: string[] = [];
    let stop: (signal: NodeJS.Signals) => void = () => undefined;
    const running = runProgram(
      ["start", "--home", home],
      context({
        layout,
        holdSleepAssertion: (pid) => {
          assertions.push(`hold ${pid}`);
          return {
            exited: new Promise(() => undefined),
            release: () => assertions.push("release"),
          };
        },
        onStopSignal: (handler) => {
          stop = handler;
        },
      }),
    );
    while (!out.some((line) => line.startsWith("Web is listening"))) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(assertions).toEqual([`hold ${process.pid}`]);
    stop("SIGTERM");
    expect(await running).toBe(0);
    expect(assertions).toEqual([`hold ${process.pid}`, "release"]);
  });

  it("start는 .env가 없으면 init을 먼저 하라고 알린다", async () => {
    expect(await runProgram(["start", "--home", join(dir, "none")], context())).toBe(1);
    expect(err.join("\n")).toContain("Run `ganger init` first");
  });
});

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  effectiveSetupScript,
  parseSharedSetup,
  runSetupArgv,
  setupMarkerPath,
} from "./worktree-setup.js";

describe("parseSharedSetup", () => {
  test("여러 줄 setup의 들여쓰기를 벗긴다", () => {
    expect(
      parseSharedSetup("scripts:\n  setup: |\n    pnpm install\n    cp a b\n  archive: |\n    x\n"),
    ).toEqual({ kind: "found", script: "pnpm install\ncp a b" });
  });

  test.each(["null", "~", "null # none"])("YAML null 값 %s는 스크립트가 없다", (value) => {
    expect(parseSharedSetup(`scripts:\n  setup: ${value}\n`)).toEqual({
      kind: "found",
      script: null,
    });
  });

  test("상대 경로로 받은 공용 git 디렉터리를 저장소 기준 절대 경로로 바꾼다", () => {
    const marker = setupMarkerPath({
      repoPath: "/repo",
      commonDir: ".git\n",
      worktreePath: "/worktrees/a",
    });
    expect(marker.startsWith("/repo/.git/ganger-setup-pending/")).toBe(true);
  });

  test("한 줄 값과 따옴표 값을 읽는다", () => {
    expect(parseSharedSetup("scripts:\n  setup: pnpm i # deps\n")).toEqual({
      kind: "found",
      script: "pnpm i",
    });
    expect(parseSharedSetup("scripts:\n  setup: 'echo ''hi'''\n")).toEqual({
      kind: "found",
      script: "echo 'hi'",
    });
  });

  test("scripts나 setup이 없으면 스크립트가 없다", () => {
    expect(parseSharedSetup("")).toEqual({ kind: "found", script: null });
    expect(parseSharedSetup("scripts:\n  archive: x\nother: y\n")).toEqual({
      kind: "found",
      script: null,
    });
  });

  test("다른 최상위 키 아래의 setup은 읽지 않는다", () => {
    expect(parseSharedSetup("scripts:\n  archive: x\nother:\n  setup: no\n")).toEqual({
      kind: "found",
      script: null,
    });
  });

  test("지원하지 않는 형식은 읽지 못했다고 돌려준다", () => {
    expect(parseSharedSetup("scripts:\n  setup: >\n    a\n")).toEqual({ kind: "unreadable" });
    expect(parseSharedSetup('scripts:\n  setup: "a\\nb"\n')).toEqual({ kind: "unreadable" });
  });

  test.each([
    ["흐름 표기", "scripts: { setup: pnpm install }\n"],
    ["따옴표 키", 'scripts:\n  "setup": pnpm install\n'],
    ["여러 줄 일반 값", "scripts:\n  setup: pnpm install\n    --frozen-lockfile\n"],
    ["들여쓰기 지정 블록", "scripts:\n  setup: |2\n    pnpm install\n"],
  ])("%s는 건너뛰거나 자르지 않고 읽지 못했다고 돌려준다", (_name, yaml) => {
    expect(parseSharedSetup(yaml)).toEqual({ kind: "unreadable" });
  });
});

describe("effectiveSetupScript", () => {
  test("정책이 없으면 로컬 스크립트가 있을 때 로컬만, 없으면 공유만 쓴다", () => {
    expect(effectiveSetupScript({ policy: undefined, local: "l", shared: "s" })).toBe("l");
    expect(effectiveSetupScript({ policy: undefined, local: " ", shared: "s" })).toBe("s");
  });

  test("정책에 따라 고른다", () => {
    expect(effectiveSetupScript({ policy: "local-only", local: "l", shared: "s" })).toBe("l");
    expect(effectiveSetupScript({ policy: "shared-only", local: "l", shared: "s" })).toBe("s");
    expect(effectiveSetupScript({ policy: "run-both", local: "l", shared: "s" })).toBe("s\n\nl");
  });

  test("고른 곳에 스크립트가 없으면 없다", () => {
    expect(effectiveSetupScript({ policy: "local-only", local: null, shared: "s" })).toBeNull();
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("runSetupArgv", () => {
  function runIn(script: string, limitSeconds = 30): { dir: string; run: () => string } {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ganger-setup-")));
    const [command, ...args] = runSetupArgv({
      rootPath: "/root-path",
      worktreePath: dir,
      script,
      lock: join(dir, "setup.lock"),
      limitSeconds,
    });
    return {
      dir,
      run: () =>
        execFileSync(command ?? "env", args, {
          encoding: "utf8",
          env: { PATH: process.env["PATH"] ?? "", SHELL: "/bin/sh" },
        }),
    };
  }

  test("워크트리에서 Orca 환경 변수와 함께 돈다", () => {
    const { dir, run } = runIn('printf "%s|%s" "$PWD" "$ORCA_ROOT_PATH" > out.txt');
    try {
      run();
      expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe(`${dir}|/root-path`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("시간을 넘기면 스크립트의 자식 프로세스까지 끝내고 잠금을 지운다", async () => {
    const { dir, run } = runIn("sleep 20 >/dev/null 2>&1 &\necho $! > child.pid\nwait", 1);
    try {
      expect(run).toThrow("Command failed");
      expect(existsSync(join(dir, "setup.lock"))).toBe(false);
      const child = Number(readFileSync(join(dir, "child.pid"), "utf8").trim());
      await vi.waitFor(() => expect(isAlive(child)).toBe(false), { timeout: 3000 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("같은 잠금의 setup이 돌고 있으면 겹쳐 돌지 않는다", () => {
    const { dir, run } = runIn("touch ran.txt");
    try {
      writeFileSync(join(dir, "setup.lock"), String(process.pid));
      expect(run).toThrow("Command failed");
      expect(existsSync(join(dir, "ran.txt"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("중간 명령이 실패하면 멈추고 실패로 끝난다", () => {
    const { dir, run } = runIn("false\ntouch after.txt");
    try {
      expect(run).toThrow("Command failed");
      expect(existsSync(join(dir, "after.txt"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { effectiveSetupScript, parseSharedSetup, runSetupArgv } from "./worktree-setup.js";

describe("parseSharedSetup", () => {
  test("여러 줄 setup의 들여쓰기를 벗긴다", () => {
    expect(
      parseSharedSetup("scripts:\n  setup: |\n    pnpm install\n    cp a b\n  archive: |\n    x\n"),
    ).toEqual({ kind: "found", script: "pnpm install\ncp a b" });
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

describe("runSetupArgv", () => {
  function runIn(script: string): { dir: string; run: () => string } {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ganger-setup-")));
    const [command, ...args] = runSetupArgv({ rootPath: "/root-path", worktreePath: dir, script });
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

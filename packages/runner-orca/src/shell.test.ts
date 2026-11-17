import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  MAX_REMOTE_COMMAND_BYTES,
  RemoteCommandTooLongError,
  quoteArg,
  toRemoteCommand,
} from "./shell.js";

const tricky = `A\nsecond line: it's "quoted" $HOME \`echo x\` \\\\ !x $(rm -rf /)`;

describe("quoteArg", () => {
  test("leaves plain words alone", () => {
    expect(quoteArg("--json")).toBe("--json");
    expect(quoteArg("id:repo::/a/b")).toBe("id:repo::/a/b");
    expect(quoteArg("term_41ac5f6b-daad")).toBe("term_41ac5f6b-daad");
  });

  test("wraps newlines, quotes and $ in single quotes and escapes single quotes", () => {
    expect(quoteArg(tricky)).toBe(
      `'A\nsecond line: it'\\''s "quoted" $HOME \`echo x\` \\\\ !x $(rm -rf /)'`,
    );
    expect(quoteArg("")).toBe("''");
    expect(quoteArg("cat > /dev/null")).toBe("'cat > /dev/null'");
  });

  // 원격 셸(zsh, bash, sh)이 인용한 인자를 글자 그대로 받는지 로컬 셸로 확인한다.
  for (const shell of ["/bin/sh", "/bin/bash", "/bin/zsh"].filter((path) => existsSync(path))) {
    test(`${shell} reads the quoted argument back unchanged`, () => {
      const out = spawnSync(shell, ["-c", `printf '%s' ${quoteArg(tricky)}`], { encoding: "utf8" });
      expect(out.status).toBe(0);
      expect(out.stdout).toBe(tricky);
    });
  }
});

describe("toRemoteCommand", () => {
  test("joins quoted arguments into one command string for an answer body", () => {
    expect(
      toRemoteCommand([
        "/Applications/Orca.app/Contents/Resources/bin/orca",
        "orchestration",
        "reply",
        "--id",
        "msg_1",
        "--body",
        `Use "B"\nand keep $PATH; don't run it`,
        "--json",
      ]),
    ).toBe(
      `/Applications/Orca.app/Contents/Resources/bin/orca orchestration reply --id msg_1 --body 'Use "B"\nand keep $PATH; don'\\''t run it' --json`,
    );
  });

  test("refuses a command over the ssh limit", () => {
    const body = "'".repeat(MAX_REMOTE_COMMAND_BYTES / 4 + 1);
    expect(() => toRemoteCommand(["orca", "--body", body])).toThrow(RemoteCommandTooLongError);
    expect(() => toRemoteCommand(["orca", "--body", "a".repeat(1000)])).not.toThrow();
  });
});

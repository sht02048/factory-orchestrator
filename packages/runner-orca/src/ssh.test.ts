import { describe, expect, test } from "vitest";
import { parseOrcaRunnerConfig } from "./config.js";
import { sshArgs } from "./ssh.js";

const gangerAccess = {
  kind: "ganger",
  identityFile: "/home/ganger/.ganger/ssh/id_ed25519",
  knownHostsFile: "/home/ganger/.ganger/ssh/known_hosts",
} as const;

describe("sshArgs", () => {
  test("a runner entered by hand uses the user's own ssh settings", () => {
    const config = parseOrcaRunnerConfig({ sshTarget: "ganger@runner.example.com" });
    expect(config.access).toBeUndefined();
    expect(sshArgs(config)).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-T",
      "--",
      "ganger@runner.example.com",
    ]);
  });

  test("a runner Ganger set up uses only the Ganger key and pinned host keys", () => {
    const config = parseOrcaRunnerConfig({
      sshTarget: "ganger@localhost",
      access: gangerAccess,
    });
    const args = sshArgs(config);
    expect(args.slice(0, 8)).toEqual([
      "-i",
      gangerAccess.identityFile,
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      `UserKnownHostsFile=${gangerAccess.knownHostsFile}`,
      "-o",
      "StrictHostKeyChecking=yes",
    ]);
    expect(args.at(-1)).toBe("ganger@localhost");
    expect(args.at(-2)).toBe("--");
  });

  test("rejects Ganger access with relative key paths", () => {
    expect(() =>
      parseOrcaRunnerConfig({
        sshTarget: "ganger@localhost",
        access: { ...gangerAccess, identityFile: "ssh/id_ed25519" },
      }),
    ).toThrow(/access.identityFile/);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { serviceInstallArgs } from "./service-install.js";

const help = readFileSync(
  new URL("../fixtures/orca-1.4.253-serve-service-install-help.txt", import.meta.url),
  "utf8",
);

function usageFlags(text: string): Set<string> {
  const usage = text
    .split("\n")
    .find((line) => line.startsWith("Usage: orca serve service install"));
  if (usage === undefined) throw new Error("help has no usage line");
  return new Set(usage.match(/--[a-z-]+/g) ?? []);
}

describe("serviceInstallArgs", () => {
  test("uses only options the Orca CLI help lists", () => {
    const known = usageFlags(help);
    const flags = serviceInstallArgs("/Applications/Orca.app/Contents/Resources/bin/orca").filter(
      (arg) => arg.startsWith("--"),
    );
    expect(flags).toEqual(["--bind", "--command"]);
    for (const flag of flags) expect(known).toContain(flag);
    expect(known).not.toContain("--refuse-public");
  });

  test("runs the given orca and points the service at the same orca", () => {
    const args = serviceInstallArgs("/opt/orca/bin/orca");
    expect(args[0]).toBe("/opt/orca/bin/orca");
    expect(args.slice(1, 4)).toEqual(["serve", "service", "install"]);
    expect(args.at(-1)).toBe("/opt/orca/bin/orca");
  });
});

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { powerSettingsPath, readPowerSettings, writePowerSettings } from "./power-settings.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ganger-power-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("power settings", () => {
  it("파일이 없으면 켜짐이고 문제가 없다", () => {
    expect(readPowerSettings(home)).toEqual({
      settings: { preventSleep: true },
      problem: undefined,
    });
  });

  it("쓴 값을 그대로 읽고, 파일은 소유자만 읽고 쓴다", () => {
    writePowerSettings(home, { preventSleep: false });
    expect(readPowerSettings(home).settings).toEqual({ preventSleep: false });
    expect(statSync(powerSettingsPath(home)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(powerSettingsPath(home), "utf8"))).toEqual({
      preventSleep: false,
    });
  });

  it("없는 home 폴더도 만들어 쓴다", () => {
    const nested = join(home, "nested");
    writePowerSettings(nested, { preventSleep: true });
    expect(readPowerSettings(nested).settings).toEqual({ preventSleep: true });
  });

  it.each([
    ["JSON이 아니면", "not json"],
    ["모양이 다르면", JSON.stringify({ preventSleep: "no" })],
  ])("%s 켜짐으로 두고 문제를 알린다", (_, contents) => {
    writeFileSync(powerSettingsPath(home), contents);
    const read = readPowerSettings(home);
    expect(read.settings).toEqual({ preventSleep: true });
    expect(read.problem).toContain(powerSettingsPath(home));
  });
});

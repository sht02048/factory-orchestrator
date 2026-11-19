import { describe, expect, it } from "vitest";
import { keepAwake } from "./keep-awake.js";
import type { HoldSleepAssertion, KeepAwakeOptions } from "./keep-awake.js";
import type { PowerSettingsRead } from "@ganger/app/power-settings";

interface FakeAssertion {
  pid: number;
  released: boolean;
  exit(reason: string): void;
}

function fakeHold() {
  const held: FakeAssertion[] = [];
  const hold: HoldSleepAssertion = (pid) => {
    let exit: (reason: string) => void = () => undefined;
    const exited = new Promise<string>((resolve) => (exit = resolve));
    const assertion: FakeAssertion = { pid, released: false, exit: (reason) => exit(reason) };
    held.push(assertion);
    return {
      exited,
      release: () => {
        assertion.released = true;
      },
    };
  };
  return { held, hold };
}

function settingsSource(initial: PowerSettingsRead) {
  let current = initial;
  return {
    read: () => current,
    set: (next: PowerSettingsRead) => {
      current = next;
    },
  };
}

const on: PowerSettingsRead = { settings: { preventSleep: true }, problem: undefined };
const off: PowerSettingsRead = { settings: { preventSleep: false }, problem: undefined };

function start(overrides: Partial<KeepAwakeOptions> & Pick<KeepAwakeOptions, "hold">) {
  const warnings: string[] = [];
  const awake = keepAwake({
    platform: "darwin",
    serverPid: 4242,
    readSettings: () => on,
    warn: (line) => warnings.push(line),
    pollMs: 60_000,
    ...overrides,
  });
  return { awake, warnings };
}

describe("keepAwake", () => {
  it("켜져 있으면 서버 pid로 잠자기 방지를 걸고, stop하면 푼다", () => {
    const { held, hold } = fakeHold();
    const { awake } = start({ hold });
    expect(held).toHaveLength(1);
    expect(held[0]?.pid).toBe(4242);
    expect(awake.holding).toBe(true);
    awake.stop();
    expect(held[0]?.released).toBe(true);
    expect(awake.holding).toBe(false);
  });

  it("설정이 꺼져 있으면 걸지 않는다", () => {
    const { held, hold } = fakeHold();
    const { awake } = start({ hold, readSettings: () => off });
    expect(held).toHaveLength(0);
    expect(awake.holding).toBe(false);
    awake.stop();
  });

  it("macOS가 아니면 걸지 않는다", () => {
    const { held, hold } = fakeHold();
    const { awake, warnings } = start({ hold, platform: "linux" });
    expect(held).toHaveLength(0);
    expect(warnings).toEqual([]);
    awake.stop();
  });

  it("다시 읽을 때 설정이 바뀌면 다시 시작 없이 풀고 다시 건다", () => {
    const { held, hold } = fakeHold();
    const source = settingsSource(on);
    const { awake } = start({ hold, readSettings: source.read });
    source.set(off);
    awake.refresh();
    expect(held[0]?.released).toBe(true);
    expect(awake.holding).toBe(false);
    source.set(on);
    awake.refresh();
    expect(held).toHaveLength(2);
    expect(awake.holding).toBe(true);
    awake.refresh();
    expect(held).toHaveLength(2);
    awake.stop();
  });

  it("caffeinate가 실패하면 경고만 하고, 설정을 다시 켤 때까지 다시 걸지 않는다", async () => {
    const { held, hold } = fakeHold();
    const source = settingsSource(on);
    const { awake, warnings } = start({ hold, readSettings: source.read });
    held[0]?.exit("could not start caffeinate: spawn caffeinate ENOENT");
    await Promise.resolve();
    await Promise.resolve();
    expect(awake.holding).toBe(false);
    expect(warnings).toEqual([
      "Warning: could not keep this Mac awake (could not start caffeinate: spawn caffeinate ENOENT). The server keeps running.",
    ]);
    awake.refresh();
    expect(held).toHaveLength(1);
    source.set(off);
    awake.refresh();
    source.set(on);
    awake.refresh();
    expect(held).toHaveLength(2);
    awake.stop();
  });

  it("거는 함수가 던져도 경고만 한다", () => {
    const { awake, warnings } = start({
      hold: () => {
        throw new Error("boom");
      },
    });
    expect(awake.holding).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("boom");
    awake.stop();
  });

  it("설정 파일을 읽지 못하면 켜짐으로 걸고 같은 문제는 한 번만 경고한다", () => {
    const { held, hold } = fakeHold();
    const broken: PowerSettingsRead = { settings: { preventSleep: true }, problem: "bad json" };
    const { awake, warnings } = start({ hold, readSettings: () => broken });
    awake.refresh();
    awake.refresh();
    expect(held).toHaveLength(1);
    expect(warnings).toEqual([
      "Warning: could not read power settings (bad json). Keeping this Mac awake.",
    ]);
    awake.stop();
  });

  it("stop한 뒤에는 다시 읽어도 걸지 않는다", () => {
    const { held, hold } = fakeHold();
    const { awake } = start({ hold });
    awake.stop();
    awake.refresh();
    expect(held).toHaveLength(1);
    expect(awake.holding).toBe(false);
  });
});

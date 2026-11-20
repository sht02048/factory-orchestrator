import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATION_PREFS } from "./notification-prefs.js";
import { fileSettingsStore } from "./settings.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function store() {
  const dir = mkdtempSync(join(tmpdir(), "ganger-desktop-settings-"));
  dirs.push(dir);
  const path = join(dir, "settings.json");
  return { path, store: fileSettingsStore(path) };
}

describe("앱 설정의 알림", () => {
  it("알림 설정과 서버별 마지막으로 본 번호를 저장하고 읽는다", () => {
    const { store: settings } = store();
    const notifications = {
      ...DEFAULT_NOTIFICATION_PREFS,
      groups: { ...DEFAULT_NOTIFICATION_PREFS.groups, failedDisconnected: false },
    };
    settings.write({
      mode: "local",
      notifications,
      notificationsSeen: { "http://127.0.0.1:4318": 12 },
    });
    expect(settings.read()).toEqual({
      mode: "local",
      notifications,
      notificationsSeen: { "http://127.0.0.1:4318": 12 },
    });
  });

  it("알림 값이 깨져 있어도 나머지 설정은 살린다", () => {
    const { path, store: settings } = store();
    writeFileSync(path, JSON.stringify({ mode: "remote", notifications: { enabled: "yes" } }));
    expect(settings.read()).toEqual({ mode: "remote" });
  });

  it("예전 Human Check 알림 종류 값이 남아 있어도 나머지 알림 설정을 그대로 읽는다 (0145)", () => {
    const { path, store: settings } = store();
    const groups = { ...DEFAULT_NOTIFICATION_PREFS.groups, permission: false };
    writeFileSync(
      path,
      JSON.stringify({
        mode: "local",
        notifications: { enabled: true, groups: { ...groups, humanCheck: false } },
      }),
    );
    expect(settings.read()).toEqual({ mode: "local", notifications: { enabled: true, groups } });
  });
});

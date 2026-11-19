import { updateFeedName } from "@ganger/app/updates/releases";
import type { ManualReason } from "@ganger/app/updates/view";
import { describe, expect, it } from "vitest";
import { CHECK_INTERVAL_MS, Updater } from "./updater.js";
import type { UpdateSettings } from "./updater.js";

const FEED = `https://github.com/acme/ganger/releases/download/v0.2.0/${updateFeedName("arm64")}`;
const NOTES = "https://github.com/acme/ganger/releases/tag/v0.2.0";

const RELEASES = [
  {
    tag_name: "v0.2.0",
    html_url: NOTES,
    draft: false,
    prerelease: false,
    assets: [{ name: updateFeedName("arm64"), browser_download_url: FEED }],
  },
];

function setup(
  options: {
    current?: string;
    settings?: UpdateSettings;
    releases?: () => Promise<unknown>;
    blocked?: ManualReason | null;
    repository?: string | null;
  } = {},
) {
  let settings: UpdateSettings = options.settings ?? {};
  let now = new Date("2026-11-19T09:00:00.000Z");
  const calls = { fetch: 0, download: [] as string[], install: 0, changes: 0 };
  const updater = new Updater({
    currentVersion: options.current ?? "0.1.0",
    arch: "arm64",
    repository: options.repository === undefined ? "acme/ganger" : options.repository,
    fetchReleases: async () => {
      calls.fetch += 1;
      return options.releases === undefined ? RELEASES : options.releases();
    },
    installer: {
      download: (url) => calls.download.push(url),
      install: () => {
        calls.install += 1;
      },
    },
    blocked: () => options.blocked ?? null,
    store: {
      read: () => settings,
      write: (next) => {
        settings = next;
      },
    },
    now: () => now,
    onChange: () => {
      calls.changes += 1;
    },
  });
  return {
    updater,
    calls,
    settings: () => settings,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    view: () => updater.view({ kind: "app", version: "0.1.0" }),
  };
}

describe("Updater", () => {
  it("확인하면 새 버전을 뒤에서 받고, 다 받으면 토스트로 묻는다", async () => {
    const { updater, calls, view, settings } = setup();
    await updater.checkNow();
    expect(calls.download).toEqual([FEED]);
    expect(view().check).toEqual({ kind: "downloading", version: "0.2.0", notesUrl: NOTES });
    expect(view().toast).toBeNull();
    expect(settings().lastCheckedAt).toBe("2026-11-19T09:00:00.000Z");

    updater.downloaded();
    expect(view().check).toEqual({ kind: "ready", version: "0.2.0", notesUrl: NOTES });
    expect(view().toast).toEqual({ kind: "ready", version: "0.2.0", notesUrl: NOTES });
    expect(calls.install).toBe(0);
  });

  it("다시 시작을 누르면 설치하고, 받기 전에는 설치하지 않는다", async () => {
    const { updater, calls, view } = setup();
    expect(updater.restart()).toBe(false);
    await updater.checkNow();
    expect(updater.restart()).toBe(false);
    updater.downloaded();
    expect(updater.restart()).toBe(true);
    expect(calls.install).toBe(1);
    expect(view().toast).toBeNull();
  });

  it("나중에를 누르면 토스트를 닫고 다시 확인해도 이번 실행에서는 다시 띄우지 않는다", async () => {
    const { updater, calls, view, advance } = setup();
    await updater.checkNow();
    updater.downloaded();
    updater.later();
    expect(view().toast).toBeNull();
    expect(view().check.kind).toBe("ready");

    advance(CHECK_INTERVAL_MS);
    await updater.tick();
    expect(calls.fetch).toBe(2);
    expect(calls.download).toHaveLength(1);
    expect(view().toast).toBeNull();
    expect(view().check.kind).toBe("ready");
  });

  it("받아 둔 새 버전이 있는 동안 더 새 버전이 나와도 다시 받지 않고 다시 시작이 받아 둔 버전을 설치한다", async () => {
    const newer = [
      {
        ...RELEASES[0],
        tag_name: "v0.2.1",
        html_url: "https://github.com/acme/ganger/releases/tag/v0.2.1",
      },
    ];
    let list: unknown = RELEASES;
    const { updater, calls, view } = setup({ releases: async () => list });
    await updater.checkNow();
    updater.downloaded();
    list = newer;
    await updater.checkNow();
    expect(calls.download).toHaveLength(1);
    expect(view().check).toEqual({ kind: "ready", version: "0.2.0", notesUrl: NOTES });
    expect(view().latest?.version).toBe("0.2.1");
    expect(view().toast?.kind).toBe("ready");
    expect(updater.restart()).toBe(true);
    expect(calls.install).toBe(1);
  });

  it("받아 둔 채 앱을 다시 열었는데 아직 옛 버전이면 다시 받아 토스트를 다시 보인다", async () => {
    const first = setup();
    await first.updater.checkNow();
    first.updater.downloaded();
    first.updater.later();
    expect(first.settings().pending).toEqual({ from: "0.1.0", to: "0.2.0", notesUrl: NOTES });

    const reopened = setup({ settings: first.settings() });
    expect(reopened.view().toast).toBeNull();
    expect(reopened.settings().pending).toBeUndefined();
    expect(reopened.updater.due()).toBe(true);
    await reopened.updater.tick();
    reopened.updater.downloaded();
    expect(reopened.view().toast).toEqual({ kind: "ready", version: "0.2.0", notesUrl: NOTES });
  });

  it("새 버전으로 다시 열리면 바꿨다는 토스트를 한 번 보이고 닫으면 사라진다", () => {
    const { updater, view, settings } = setup({
      current: "0.2.0",
      settings: { pending: { from: "0.1.0", to: "0.2.0", notesUrl: NOTES } },
    });
    expect(view().toast).toEqual({ kind: "updated", version: "0.2.0", notesUrl: NOTES });
    expect(settings().pending).toBeUndefined();
    updater.dismissUpdated();
    expect(view().toast).toBeNull();
  });

  it("자동 업데이트를 끄면 때가 되어도 확인하지 않는다", async () => {
    const { updater, calls, advance } = setup();
    updater.setAutoUpdate(false);
    expect(updater.autoUpdate).toBe(false);
    advance(CHECK_INTERVAL_MS * 3);
    await updater.tick();
    expect(calls.fetch).toBe(0);

    updater.setAutoUpdate(true);
    await updater.tick();
    expect(calls.fetch).toBe(1);
  });

  it("자동 업데이트를 켜면 마지막 확인에서 6시간이 지났을 때만 다시 확인한다", async () => {
    const { updater, calls, advance } = setup({ releases: async () => [] });
    await updater.tick();
    expect(calls.fetch).toBe(1);
    advance(CHECK_INTERVAL_MS - 1);
    await updater.tick();
    expect(calls.fetch).toBe(1);
    advance(1);
    await updater.tick();
    expect(calls.fetch).toBe(2);
  });

  it("새 버전이 없으면 최신이고 마지막 확인 시각을 남긴다", async () => {
    const { updater, view } = setup({ releases: async () => [] });
    await updater.checkNow();
    expect(view().check).toEqual({ kind: "latest" });
    expect(view().latest).toBeNull();
    expect(view().lastCheckedAt).toBe("2026-11-19T09:00:00.000Z");
  });

  it.each([
    ["outside-applications", "Applications 밖에서 실행"],
    ["no-permission", "바꿀 권한 없음"],
  ] as const)("%s(%s)이면 받지 않고 손으로 받으라고 보인다", async (reason, _case) => {
    const { updater, calls, view } = setup({ blocked: reason });
    await updater.checkNow();
    expect(calls.download).toEqual([]);
    expect(view().check).toEqual({ kind: "manual", reason, version: "0.2.0", notesUrl: NOTES });
    expect(view().toast).toBeNull();
  });

  it("업데이트 주소가 없는 빌드는 확인하지 않는다", async () => {
    const { updater, calls, view } = setup({ repository: null });
    expect(updater.due()).toBe(false);
    await updater.checkNow();
    expect(calls.fetch).toBe(0);
    expect(view().check).toEqual({ kind: "unavailable" });
  });

  it("확인이나 받기가 실패하면 실패로 보이고 다음 확인에서 다시 시도한다", async () => {
    let fail = true;
    const { updater, view, calls } = setup({
      releases: async () => {
        if (fail) throw new Error("offline");
        return RELEASES;
      },
    });
    await updater.checkNow();
    expect(view().check).toEqual({ kind: "failed" });
    expect(view().lastCheckedAt).toBeNull();
    fail = false;
    await updater.checkNow();
    expect(view().check.kind).toBe("downloading");
    updater.failed();
    expect(view().check).toEqual({ kind: "failed" });
    await updater.checkNow();
    expect(calls.download).toHaveLength(2);
  });

  it("확인하는 동안 다시 확인하지 않는다", async () => {
    let release: (value: unknown) => void = () => undefined;
    const { updater, calls } = setup({
      releases: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const first = updater.checkNow();
    await updater.checkNow();
    release([]);
    await first;
    expect(calls.fetch).toBe(1);
  });

  it("보이는 상태에 앱 버전과 서버 버전을 함께 싣는다", () => {
    const { updater } = setup();
    expect(updater.view({ kind: "remote", version: "0.0.9" })).toMatchObject({
      appVersion: "0.1.0",
      server: { kind: "remote", version: "0.0.9" },
      autoUpdate: true,
    });
  });
});

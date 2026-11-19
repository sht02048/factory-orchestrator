import { DESKTOP_UPDATES_GLOBAL } from "@ganger/app/updates/view";
import type { UpdateAction, UpdateView } from "@ganger/app/updates/view";
import { describe, expect, it } from "vitest";
import shell from "../../messages/ko/shell.json" with { type: "json" };
import { renderWithMessages } from "../testing/render";
import { desktopUpdates } from "./desktop-updates";
import { UpdateToast } from "./update-toast";

const NOTES = "https://github.com/acme/ganger/releases/tag/v0.2.0";

function text(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

describe("업데이트 토스트(0083)", () => {
  it("다 받으면 새 버전, 서버도 바뀐다는 한 문장, 다시 시작·나중에, 바뀐 내용을 보인다", () => {
    const html = renderWithMessages(
      <UpdateToast
        toast={{ kind: "ready", version: "0.2.0", notesUrl: NOTES }}
        serverKind="app"
        serverVersion="0.1.0"
        act={() => {}}
      />,
    );
    const shown = text(html);
    expect(shown).toContain("새 버전 0.2.0을 받았어요");
    expect(shown).toContain(shell.update.ready.bodyWithServer);
    expect(shown).toContain(shell.update.ready.restart);
    expect(shown).toContain(shell.update.ready.later);
    expect(html).toMatch(
      new RegExp(
        `href="${NOTES}" target="_blank" rel="noreferrer"[^>]*>${shell.update.ready.notes}<`,
      ),
    );
    expect([...html.matchAll(/data-variant="primary"/g)]).toHaveLength(1);
    expect(html).not.toMatch(/autofocus|role="alert"/i);
  });

  it("앱이 띄우지 않은 서버면 앱만 바뀐다고 말한다", () => {
    const shown = text(
      renderWithMessages(
        <UpdateToast
          toast={{ kind: "ready", version: "0.2.2", notesUrl: NOTES }}
          serverKind="remote"
          serverVersion="0.1.0"
          act={() => {}}
        />,
      ),
    );
    expect(shown).toContain("새 버전 0.2.2를 받았어요");
    expect(shown).toContain(shell.update.ready.bodyAppOnly);
  });

  it("바꾼 뒤에는 바꾼 버전과 바뀐 내용 링크, 닫기를 보인다", () => {
    const html = renderWithMessages(
      <UpdateToast
        toast={{ kind: "updated", version: "0.2.0", notesUrl: NOTES }}
        serverKind="app"
        serverVersion="0.2.0"
        act={() => {}}
      />,
    );
    const shown = text(html);
    expect(shown).toContain("0.2.0으로 바꿨어요");
    expect(shown).toContain(shell.update.updated.bodyWithServer);
    expect(shown).toContain(shell.update.updated.notes);
    expect(shown).toContain(shell.update.updated.close);
  });

  it("원격 서버의 판이 다르면 바꾼 뒤에도 서버는 따로 바꾸라고 말한다", () => {
    const shown = text(
      renderWithMessages(
        <UpdateToast
          toast={{ kind: "updated", version: "0.2.1", notesUrl: NOTES }}
          serverKind="remote"
          serverVersion="0.1.0"
          act={() => {}}
        />,
      ),
    );
    expect(shown).toContain("0.2.1로 바꿨어요");
    expect(shown).toContain("서버는 아직 0.1.0 버전이에요");
  });
});

describe("데스크톱 업데이트 다리(0083)", () => {
  const sample: UpdateView = {
    appVersion: "0.1.0",
    server: { kind: "app", version: "0.1.0" },
    autoUpdate: true,
    lastCheckedAt: null,
    latest: null,
    check: { kind: "idle" },
    toast: null,
  };

  it("브라우저에는 다리가 없다", () => {
    expect(desktopUpdates({})).toBeNull();
    expect(desktopUpdates({ [DESKTOP_UPDATES_GLOBAL]: { getUpdate: 1 } })).toBeNull();
  });

  it("받은 상태를 경계에서 파싱해 모양이 다른 값은 버리고, 행동을 넘긴다", async () => {
    const listeners: Array<(value: unknown) => void> = [];
    const acted: string[] = [];
    const bridge = desktopUpdates({
      [DESKTOP_UPDATES_GLOBAL]: {
        getUpdate: () => Promise.resolve({ appVersion: 1 }),
        onUpdate: (listener: (value: unknown) => void) => {
          listeners.push(listener);
          return () => listeners.splice(listeners.indexOf(listener), 1);
        },
        act: (action: string) => {
          acted.push(action);
          return Promise.resolve();
        },
      },
    });
    if (bridge === null) throw new Error("bridge missing");
    expect(await bridge.current()).toBeNull();
    const seen: UpdateView[] = [];
    const off = bridge.subscribe((value) => seen.push(value));
    for (const listener of listeners) {
      listener({ nope: true });
      listener(sample);
    }
    expect(seen).toEqual([sample]);
    off();
    expect(listeners).toHaveLength(0);
    const action: UpdateAction = "later";
    bridge.act(action);
    expect(acted).toEqual(["later"]);
  });
});

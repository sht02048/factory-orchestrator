import { windowFrame } from "@ganger/ui/window-frame";
import { describe, expect, it } from "vitest";
import { DRAG_REGION_SELECTOR, addDragHandleIfMissing } from "./drag-handle.js";
import type { DragHandleHost } from "./drag-handle.js";

interface FakeElement {
  attributes: Map<string, string>;
  styles: Map<string, string>;
  style: { setProperty(name: string, value: string): void };
  setAttribute(name: string, value: string): void;
}

function fakeElement(): FakeElement {
  const attributes = new Map<string, string>();
  const styles = new Map<string, string>();
  return {
    attributes,
    styles,
    style: { setProperty: (name, value) => void styles.set(name, value) },
    setAttribute: (name, value) => void attributes.set(name, value),
  };
}

function host(hasDragRegion: boolean) {
  const created: FakeElement[] = [];
  const appended: unknown[] = [];
  const doc: DragHandleHost<FakeElement> = {
    querySelector: (selector) => (hasDragRegion && selector === DRAG_REGION_SELECTOR ? {} : null),
    createElement: () => {
      const element = fakeElement();
      created.push(element);
      return element;
    },
    body: { append: (node) => void appended.push(node) },
  };
  return { doc, appended: () => created.filter((element) => appended.includes(element)) };
}

describe("예전 서버 화면의 창 끌기 손잡이(0113)", () => {
  it("서버 화면이 끌기 영역을 그리면 손잡이를 더하지 않는다", () => {
    const { doc, appended } = host(true);
    expect(addDragHandleIfMissing(doc)).toBe(false);
    expect(appended()).toEqual([]);
  });

  it("끌기 영역이 없는 예전 서버 화면에는 레일 위 신호등 자리에 끌기 손잡이를 둔다", () => {
    const { doc, appended } = host(false);
    expect(addDragHandleIfMissing(doc)).toBe(true);
    expect(appended()).toHaveLength(1);
    const [handle] = appended();
    expect(handle?.attributes.get("data-app-region")).toBe("drag");
    expect(handle?.attributes.get("aria-hidden")).toBe("true");
    expect(Object.fromEntries(handle?.styles ?? [])).toMatchObject({
      position: "fixed",
      top: "0",
      left: "0",
      width: `${windowFrame.railWidth}px`,
      height: `${windowFrame.titleBarHeight}px`,
      "-webkit-app-region": "drag",
    });
  });
});

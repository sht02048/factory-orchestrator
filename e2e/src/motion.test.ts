import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, openDatabase } from "@ganger/db";
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import ds from "../../apps/web/messages/ko/ds.json" with { type: "json" };
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));
const encryptionKey = new Uint8Array(32).fill(7);
const text = ds.motionDemo;

declare global {
  var motionCalls: string[];
  var viewTransitionCalls: number;
  var motionSlow: boolean;
}

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;

const fakeAdapters: Plugin = {
  name: "e2e-motion-fake-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? fakeAdaptersModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-motion-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [fakeAdapters],
    cacheDir: join(dir, "vite-cache"),
  }));
  browser = await chromium.launch({ channel: "chrome" });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await web?.close();
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

async function openDs(
  testName: string,
  reducedMotion: "reduce" | "no-preference",
  viewTransitions: "native" | "absent" = "native",
): Promise<Page> {
  const context = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    reducedMotion,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = testName.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await page.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
  await page.addInitScript(() => {
    const seen: string[] = [];
    // oxlint-disable-next-line typescript/unbound-method
    const original = Element.prototype.animate;
    Element.prototype.animate = function animate(keyframes, options) {
      const names = keyframes === null ? [] : Object.keys(keyframes);
      seen.push(names.join(","));
      const animation = original.call(this, keyframes, options);
      if (globalThis.motionSlow) animation.playbackRate = 0.01;
      return animation;
    };
    globalThis.motionCalls = seen;
    globalThis.viewTransitionCalls = 0;
    globalThis.motionSlow = false;
  });
  await page.addInitScript((mode) => {
    if (mode === "absent") {
      Reflect.deleteProperty(Document.prototype, "startViewTransition");
      return;
    }
    const native = document.startViewTransition.bind(document);
    document.startViewTransition = (update) => {
      globalThis.viewTransitionCalls += 1;
      return native(update);
    };
  }, viewTransitions);
  await page.goto("/ds");
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
  await page.locator("#motionPrimitives").scrollIntoViewIfNeeded();
  return page;
}

const motionCalls = (page: Page) => page.evaluate(() => globalThis.motionCalls.slice());
const clearCalls = (page: Page) =>
  page.evaluate(() => {
    globalThis.motionCalls.length = 0;
  });
const press = (page: Page, name: string) =>
  page.locator("#motionPrimitives").getByRole("button", { name, exact: true }).click();
const cards = (page: Page, column: string) =>
  page
    .locator(`[data-motion-column="${column}"] [data-motion-card]`)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-motion-card")));

const slowMotion = (page: Page) =>
  page.evaluate(() => {
    globalThis.motionSlow = true;
  });
const hideTab = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  });
const exitedText = (count: number) => text.exited.replace("{count}", String(count));
const exitedStatus = (page: Page) =>
  page.locator("#motionPrimitives").getByRole("status").first().textContent();

describe("공용 움직임(브라우저, 0152)", () => {
  it("첫 렌더에서는 목록이 움직이지 않는다", async (context) => {
    const page = await openDs(context.task.name, "no-preference");
    expect(await motionCalls(page)).toEqual([]);
    await page.context().close();
  });

  it("빠진 항목은 움직임이 끝난 뒤 DOM 에서 빠지고 알림이 온다", async (context) => {
    const page = await openDs(context.task.name, "no-preference");
    await press(page, text.remove);
    expect(await motionCalls(page)).toContain("gridTemplateRows,opacity");
    await expect.poll(() => cards(page, text.queued)).toEqual(["2", "3", "4"]);
    await page
      .locator("#motionPrimitives")
      .getByRole("status")
      .filter({ hasText: text.exited.replace("{count}", "1") })
      .waitFor();
    await page.context().close();
  });

  it("한꺼번에 4장이 바뀌면 미끄러지지 않고 흐려진다", async (context) => {
    const page = await openDs(context.task.name, "no-preference");
    await clearCalls(page);
    await press(page, text.burst);
    await expect.poll(() => cards(page, text.running)).toEqual(["1", "2", "3", "4", "5", "6"]);
    const calls = await motionCalls(page);
    expect(calls).toContain("opacity");
    expect(calls).not.toContain("transform");
    await page.context().close();
  });

  it("움직임 줄이기에서는 들어오기·빠지기가 흐려지기만 한다", async (context) => {
    const page = await openDs(context.task.name, "reduce");
    await press(page, text.add);
    await press(page, text.remove);
    await expect.poll(() => cards(page, text.queued)).toEqual(["1", "2", "3", "4"]);
    const calls = await motionCalls(page);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call === "opacity")).toBe(true);
    await page.context().close();
  });

  it("대화상자를 닫는 도중 다시 열면 같은 요소가 되돌아온다", async (context) => {
    const page = await openDs(context.task.name, "no-preference");
    const trigger = page.getByRole("button", { name: ds.dialog.trigger, exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await expect.poll(() => dialog.evaluate((node) => getComputedStyle(node).opacity)).toBe("1");

    const reopened = await dialog.evaluate(async (node) => {
      const slow = (animation: Animation) => {
        animation.playbackRate = 0.05;
      };
      node.setAttribute("data-motion-probe", "same");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      for (let frame = 0; frame < 60 && !node.hasAttribute("data-ending-style"); frame += 1) {
        await new Promise(requestAnimationFrame);
      }
      const ending = node.hasAttribute("data-ending-style");
      node.getAnimations().forEach(slow);
      return ending;
    });
    expect(reopened).toBe(true);

    await page.evaluate(() => {
      const opener = [...document.querySelectorAll("button")].find(
        (button) => button.getAttribute("aria-haspopup") === "dialog",
      );
      opener?.click();
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const node = document.querySelector('[data-motion-probe="same"]');
          return node !== null && !node.hasAttribute("data-ending-style");
        }),
      )
      .toBe(true);
    await page.context().close();
  });

  it("View Transitions 가 되면 칸 옮기기에 그것을 쓰고 끝나면 이름을 지운다", async (context) => {
    const page = await openDs(context.task.name, "no-preference");
    await press(page, text.move);
    await expect.poll(() => cards(page, text.running)).toEqual(["1", "5", "6"]);
    expect(await page.evaluate(() => globalThis.viewTransitionCalls)).toBe(1);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.querySelectorAll('[style*="view-transition-name"]').length +
            document.getAnimations().filter((animation) => {
              const effect = animation.effect;
              return (
                effect instanceof KeyframeEffect &&
                effect.pseudoElement?.startsWith("::view-transition") === true
              );
            }).length,
        ),
      )
      .toBe(0);
    await page.context().close();
  });

  it("View Transitions 가 없으면 FLIP 으로 미끄러진다", async (context) => {
    const page = await openDs(context.task.name, "no-preference", "absent");
    await clearCalls(page);
    await press(page, text.move);
    await expect.poll(() => cards(page, text.running)).toEqual(["1", "5", "6"]);
    expect(await motionCalls(page)).toContain("transform");
    await page.context().close();
  });

  it("대화상자 닫기는 140ms, 움직임 줄이기에서는 크기 변화 없이 150ms 이하다", async (context) => {
    for (const [mode, duration, moves] of [
      ["no-preference", "0.14s", true],
      ["reduce", "0.15s", false],
    ] as const) {
      const page = await openDs(`${context.task.name}-${mode}`, mode);
      await page.getByRole("button", { name: ds.dialog.trigger, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect.poll(() => dialog.evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
      const closing = await dialog.evaluate(async (node) => {
        const open = getComputedStyle(node).transform;
        node.ownerDocument.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        for (let frame = 0; frame < 60 && !node.hasAttribute("data-ending-style"); frame += 1) {
          await new Promise(requestAnimationFrame);
        }
        const transitions = node.getAnimations();
        transitions.forEach((animation) => animation.finish());
        const style = getComputedStyle(node);
        return {
          duration: style.transitionDuration,
          moved: style.transform !== open,
          ending: node.hasAttribute("data-ending-style"),
        };
      });
      expect(closing.ending).toBe(true);
      expect(closing.duration).toBe(duration);
      expect(closing.moved).toBe(moves);
      await page.context().close();
    }
  });

  it("빠지던 행이 탭이 숨은 사이 돌아오면 보이고 빠짐 알림은 오지 않는다", async (context) => {
    const page = await openDs(context.task.name, "no-preference");
    await slowMotion(page);
    await press(page, text.remove);
    await hideTab(page);
    await press(page, text.restore);
    await expect.poll(() => cards(page, text.queued)).toEqual(["1", "2", "3", "4"]);
    await expect
      .poll(() =>
        page.locator('[data-motion-key="card-1"]').evaluate((node) => ({
          opacity: getComputedStyle(node).opacity,
          tall: node.getBoundingClientRect().height > 0,
          animations: node.getAnimations().length,
        })),
      )
      .toEqual({ opacity: "1", tall: true, animations: 0 });
    expect(await exitedStatus(page)).toBe(exitedText(0));
    await page.context().close();
  });

  it("빠지는 중 탭이 숨고 다른 커밋이 와도 빠짐 알림은 한 번이다", async (context) => {
    const page = await openDs(context.task.name, "no-preference");
    await slowMotion(page);
    await press(page, text.remove);
    await hideTab(page);
    await press(page, text.add);
    await expect.poll(() => exitedStatus(page)).toBe(exitedText(1));
    await press(page, text.add);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50))),
    );
    expect(await exitedStatus(page)).toBe(exitedText(1));
    await page.context().close();
  });

  it("바뀌지 않은 목록은 위쪽 높이가 함께 바뀌어도 움직이지 않는다", async (context) => {
    const page = await openDs(context.task.name, "no-preference", "absent");
    await slowMotion(page);
    await page.evaluate((queued) => {
      const column = document.querySelector(`[data-motion-column="${queued}"]`);
      const board = column?.parentElement?.parentElement;
      if (!(column instanceof HTMLElement) || !(board instanceof HTMLElement)) return;
      new MutationObserver(() => {
        board.style.marginTop = "40px";
      }).observe(column, { childList: true, subtree: true });
    }, text.queued);
    await press(page, text.reorder);
    await expect.poll(() => cards(page, text.queued)).toEqual(["4", "1", "2", "3"]);
    const running = await page
      .locator('[data-motion-key="card-5"] > div')
      .evaluate((node) => node.getAnimations().length);
    expect(running).toBe(0);
    await page.context().close();
  });

  it("Sheet 닫기는 같은 쪽으로 나가고, 움직임 줄이기에서는 이동 없이 흐려진다", async (context) => {
    for (const [mode, duration, moves] of [
      ["no-preference", "0.18s", true],
      ["reduce", "0.15s", false],
    ] as const) {
      const page = await openDs(`${context.task.name}-${mode}`, mode);
      const opener = page.getByRole("button", { name: ds.blocks.sheet.open, exact: true });
      await opener.scrollIntoViewIfNeeded();
      await opener.click();
      const sheet = page.getByRole("dialog");
      await expect
        .poll(() =>
          sheet.evaluate(
            (node) =>
              !node.hasAttribute("data-starting-style") &&
              node.getAnimations().every((animation) => animation.playState === "finished"),
          ),
        )
        .toBe(true);
      const closing = await sheet.evaluate(async (node) => {
        const left = node.getBoundingClientRect().left;
        node.ownerDocument.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        for (let frame = 0; frame < 60 && !node.hasAttribute("data-ending-style"); frame += 1) {
          await new Promise(requestAnimationFrame);
        }
        const style = getComputedStyle(node);
        const durationValue = style.transitionDuration;
        node.getAnimations().forEach((animation) => animation.finish());
        return { duration: durationValue, moved: node.getBoundingClientRect().left > left };
      });
      expect(closing).toEqual({ duration, moved: moves });
      await page.context().close();
    }
  });
});

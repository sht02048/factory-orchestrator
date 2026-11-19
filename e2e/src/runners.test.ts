import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toAgentId,
  toCodeHostKind,
  toLabelId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import {
  SecretBox,
  migrate,
  openDatabase,
  recordProviderUsage,
  recordRunnerCheck,
  saveAutoAssignLabel,
  saveCodeHostConnection,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import runners from "../../apps/web/messages/ko/runners.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const encryptionKey = new Uint8Array(32).fill(7);

const longRunnerName = "build-runner-with-a-very-long-name-for-the-acme-staging-cluster";
const longRunner = toRunnerId("runner-long");
const longProject = "acme/a-very-long-repository-name-that-does-not-fit-in-one-card-line";
const longProjectId = toRunnerProjectId(`github:${longProject}`);
const selectedRunner = toRunnerId("runner-z");
const fillerCount = 8;

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;

const fakeAdapters: Plugin = {
  name: "e2e-fake-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? fakeAdaptersModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-runners-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);

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

describe("Runners 목록 + 패널(브라우저, 0057·0071)", () => {
  it("sel 로 러너를 골라 들어오면 그 행을 고르고 포커스하고 패널에 그 러너를 보인다", async (context) => {
    const page = await openPage(context.task.name, { width: 1280, height: 600 });
    await page.goto(`/runners?ws=${workspaceId}&sel=${selectedRunner}`);
    await hydrated(page);

    const list = page.getByRole("listbox", { name: runners.listLabel });
    const row = list.getByRole("option").filter({ has: page.locator(`#runner-${selectedRunner}`) });
    await expect.poll(async () => row.evaluate((el) => el === document.activeElement)).toBe(true);
    expect(await row.getAttribute("aria-selected")).toBe("true");
    const panel = page.getByRole("region", { name: runners.panel.label });
    expect(
      await panel.getByRole("heading", { level: 2, name: "runner-z", exact: true }).isVisible(),
    ).toBe(true);
    const box = await row.boundingBox();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? Number.POSITIVE_INFINITY) + (box?.height ?? 0)).toBeLessThanOrEqual(601);
  });

  it("행을 누르면 패널과 주소의 sel 이 그 러너로 바뀐다", async (context) => {
    const page = await openPage(context.task.name, { width: 1280, height: 800 });
    await page.goto(`/runners?ws=${workspaceId}`);
    await hydrated(page);

    await page
      .getByRole("option")
      .filter({ has: page.locator(`#runner-${longRunner}`) })
      .click();
    const panel = page.getByRole("region", { name: runners.panel.label });
    await panel.getByRole("heading", { level: 2, name: longRunnerName, exact: true }).waitFor();
    await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBe(longRunner);
    expect(await panel.getByRole("button", { name: runners.panel.recheck }).count()).toBe(0);
  });

  it("긴 러너 이름과 긴 확인 항목 이름을 패널 안에서 자르지 않고 줄을 바꾼다", async (context) => {
    const page = await openPage(context.task.name, { width: 1280, height: 800 });
    await page.goto(`/runners?ws=${workspaceId}&sel=${longRunner}`);
    await hydrated(page);

    const panel = page.getByRole("region", { name: runners.panel.label });
    const checkName = panel.getByText(`GitHub push 권한: ${longProject}`, { exact: true });
    const title = panel.getByRole("heading", { name: longRunnerName, exact: true });
    await checkName.waitFor();

    const panelBox = await panel.boundingBox();
    for (const [target, text] of [
      [checkName, `GitHub push 권한: ${longProject}`],
      [title, longRunnerName],
    ] as const) {
      const layout = await textLayout(page, "aside", text);
      expect(layout.whiteSpace).not.toBe("nowrap");
      expect(layout.textOverflow).not.toBe("ellipsis");
      expect(layout.overflowing).toBe(false);
      expect(layout.lines).toBeGreaterThan(1);
      const box = await target.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
        (panelBox?.x ?? 0) + (panelBox?.width ?? 0),
      );
    }
  });

  it("문제 러너의 해결 상자에서 다시 확인을 누르면 확인을 요청했다고 알린다", async (context) => {
    const page = await openPage(context.task.name, { width: 1280, height: 800 });
    await page.goto(`/runners?ws=${workspaceId}&sel=${selectedRunner}`);
    await hydrated(page);

    const panel = page.getByRole("region", { name: runners.panel.label });
    const fix = panel.getByRole("region", { name: runners.panel.fix.offline.title });
    await fix.getByRole("button", { name: runners.panel.recheck }).click();
    await expect
      .poll(async () => panel.getByRole("status").textContent())
      .toBe(runners.panel.recheckStatus.requested);
  });
});

describe("Runners 다시 그리기(브라우저, 0092)", () => {
  it("1280px에서 행의 세 칸이 열 머리와 같은 x에서 시작하고 목록은 900px를 넘지 않는다", async (context) => {
    const page = await openPage(context.task.name, { width: 1280, height: 800 });
    await page.goto(`/runners?ws=${workspaceId}&sel=${longRunner}`);
    await hydrated(page);

    const header = page
      .getByRole("main")
      .locator("span")
      .filter({ hasText: new RegExp(`^${runners.columns.capacity}$`) })
      .first();
    const usageHeader = page.getByText(runners.columns.usage, { exact: true });
    const row = page.getByRole("option").filter({ has: page.locator(`#runner-${longRunner}`) });
    const capacityCells = row.getByRole("img", { name: "2자리 중 0자리 사용" });
    const meter = row.getByRole("meter");
    const [headerBox, usageHeaderBox, capacityBox, meterBox, listBox] = await Promise.all([
      header.boundingBox(),
      usageHeader.boundingBox(),
      capacityCells.boundingBox(),
      meter.boundingBox(),
      page.getByRole("listbox", { name: runners.listLabel }).boundingBox(),
    ]);
    expect(Math.round(capacityBox?.x ?? -1)).toBe(Math.round(headerBox?.x ?? -2));
    expect(Math.round(meterBox?.x ?? -1)).toBe(Math.round(usageHeaderBox?.x ?? -2));
    expect(listBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(900);
  });

  it("패널의 사용량 막대와 확인 항목 이름이 같은 x에서 시작한다", async (context) => {
    const page = await openPage(context.task.name, { width: 1280, height: 1000 });
    await page.goto(`/runners?ws=${workspaceId}&sel=${longRunner}`);
    await hydrated(page);

    const panel = page.getByRole("region", { name: runners.panel.label });
    const bar = panel.getByRole("meter").first();
    const check = panel.getByText(`GitHub push 권한: ${longProject}`, { exact: true });
    await check.waitFor();
    const [barBox, checkBox] = await Promise.all([bar.boundingBox(), check.boundingBox()]);
    expect(Math.round(barBox?.x ?? -1)).toBe(Math.round(checkBox?.x ?? -2));
    expect(await panel.getByText(runners.panel.usage.atLimit, { exact: false }).count()).toBe(1);
  });

  it("400px에서 페이지가 가로로 넘치지 않는다", async (context) => {
    const page = await openPage(context.task.name, { width: 400, height: 800 });
    await page.goto(`/runners?ws=${workspaceId}&sel=${longRunner}`);
    await hydrated(page);

    const overflow: unknown = await page.evaluate(
      "document.documentElement.scrollWidth - document.documentElement.clientWidth",
    );
    expect(overflow).toBe(0);
    expect(await page.getByText(runners.columns.usage, { exact: true }).isVisible()).toBe(false);
  });
});

interface TextLayout {
  whiteSpace: string;
  textOverflow: string;
  overflowing: boolean;
  lines: number;
}

async function textLayout(page: Page, scope: string, text: string): Promise<TextLayout> {
  const raw: unknown = await page.evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(`${scope} h2, ${scope} span`)})].find(
      (e) => e.textContent === ${JSON.stringify(text)},
    );
    if (el === undefined) return null;
    const style = getComputedStyle(el);
    return {
      whiteSpace: style.whiteSpace,
      textOverflow: style.textOverflow,
      overflowing: el.scrollWidth > el.clientWidth,
      lines: Math.round(el.getBoundingClientRect().height / Number.parseFloat(style.lineHeight)),
    };
  })()`);
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("whiteSpace" in raw && typeof raw.whiteSpace === "string") ||
    !("textOverflow" in raw && typeof raw.textOverflow === "string") ||
    !("overflowing" in raw && typeof raw.overflowing === "boolean") ||
    !("lines" in raw && typeof raw.lines === "number")
  ) {
    throw new Error(`unexpected layout: ${JSON.stringify(raw)}`);
  }
  return {
    whiteSpace: raw.whiteSpace,
    textOverflow: raw.textOverflow,
    overflowing: raw.overflowing,
    lines: raw.lines,
  };
}

async function openPage(
  testName: string,
  viewport: { width: number; height: number },
): Promise<Page> {
  const browserContext = await browser.newContext({ baseURL: baseUrl, locale: "ko-KR", viewport });
  const page = await browserContext.newPage();
  page.setDefaultTimeout(30_000);
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = testName.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await page.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
  return page;
}

function seed(db: Database): void {
  saveTrackerConnection(db, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "secret" },
  });
  saveCodeHostConnection(db, new SecretBox(encryptionKey), {
    id: toCodeHostConnectionId("github"),
    kind: toCodeHostKind("github"),
    name: "github",
    config: {},
    secrets: { token: "github_pat_example" },
  });
  saveWorkspace(db, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(db, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: toTrackerStateId("in-progress"),
  });
  saveMapping(db, {
    connection,
    trackerProject,
    runnerProject: longProjectId,
    agent: toAgentId("claude"),
  });
  saveAutoAssignLabel(db, { workspaceId, connection, labelId: toLabelId("factory") });

  saveRunner(db, {
    id: longRunner,
    kind: toRunnerKind("fake"),
    name: longRunnerName,
    config: {},
    capacity: 2,
  });
  recordRunnerCheck(db, {
    runnerId: longRunner,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: longProjectId, displayName: longProject, setupState: "ready" as const }],
    assignmentBlocked: false,
    prerequisites: [
      {
        id: `github-push:${longProjectId}`,
        name: `GitHub push access: ${longProject}`,
        satisfied: false,
        hint: null,
        blocksAssignment: false,
      },
    ],
  });

  recordProviderUsage(db, {
    runnerId: longRunner,
    readAt: new Date(),
    reading: {
      kind: "read",
      providers: [
        {
          provider: "claude",
          status: "ok",
          windows: [
            { kind: "session", usedPercent: 100, resetsAt: new Date(Date.now() + 60 * 60_000) },
            { kind: "weekly", usedPercent: 42, resetsAt: null },
          ],
        },
      ],
    },
  });

  for (let i = 0; i < fillerCount; i += 1) {
    saveRunner(db, {
      id: toRunnerId(`runner-${String(i)}`),
      kind: toRunnerKind("fake"),
      name: `runner-${String(i)}`,
      config: {},
      capacity: 2,
    });
  }
  saveRunner(db, {
    id: selectedRunner,
    kind: toRunnerKind("fake"),
    name: "runner-z",
    config: {},
    capacity: 2,
  });
}

async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}

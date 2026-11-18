import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AdapterRegistry,
  toAgentId,
  toCodeHostKind,
  toLabelId,
  toRunnerId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerStateId,
} from "@factory/core";
import { FakeTracker } from "@factory/core/testing";
import {
  SecretBox,
  migrate,
  openDatabase,
  recordRunnerCheck,
  saveAutoAssignLabel,
  saveCodeHostConnection,
  saveMapping,
  saveRunner,
  saveTrackerConnection,
  saveWorkspace,
  saveWorkspaceTrackerProject,
  toCodeHostConnectionId,
} from "@factory/db";
import type { Database } from "@factory/db";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext, Page, Route } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import shell from "../../apps/web/messages/ko/shell.json" with { type: "json" };
import tickets from "../../apps/web/messages/ko/tickets.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const runnerId = toRunnerId("runner-a");
const runnerProject = toRunnerProjectId("fake:acme/web");
const agent = toAgentId("claude");
const encryptionKey = new Uint8Array(32).fill(7);
const trackerReadLimit = 1000;
const registryKey = "__factoryE2eTicketsRegistry";
const secretBoxKey = "__factoryE2eTicketsSecretBox";
const virtualAdapters = "\0e2e-tickets-adapters";

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;
const fakeAdapters: Plugin = {
  name: "e2e-tickets-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? virtualAdapters : null;
  },
  load(id) {
    if (id !== virtualAdapters) return null;
    return [
      `export function getAdapterRegistry() { return globalThis[${JSON.stringify(registryKey)}]; }`,
      `export function getSecretBox() { return globalThis[${JSON.stringify(secretBoxKey)}]; }`,
    ].join("\n");
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "factory-tickets-"));
  const dbPath = join(dir, "factory.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);

  const tracker = new FakeTracker(fakeKind);
  for (let i = 1; i <= trackerReadLimit + 1; i += 1) {
    tracker.addTicket({
      key: toTicketKey(`ACME-${i}`),
      title: `Ticket number ${i}`,
      body: "",
      url: `https://tracker.example.com/ACME-${i}`,
      labels: [],
      project: { id: trackerProject, name: "Web" },
      state: { id: toTrackerStateId("todo"), name: "Todo", category: "unstarted" },
      updatedAt: new Date(Date.UTC(2026, 10, 17) - i * 60_000),
    });
  }
  Object.assign(globalThis, {
    [registryKey]: new AdapterRegistry().registerTracker({
      kind: fakeKind,
      create: () => tracker,
    }),
    [secretBoxKey]: new SecretBox(encryptionKey),
  });

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
  Reflect.deleteProperty(globalThis, registryKey);
  Reflect.deleteProperty(globalThis, secretBoxKey);
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async (context) => {
  const browserContext: BrowserContext = await browser.newContext({
    baseURL: baseUrl,
    locale: "ko-KR",
    timezoneId: "UTC",
    viewport: { width: 1280, height: 720 },
  });
  page = await browserContext.newPage();
  page.setDefaultTimeout(30_000);
  const current = page;
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await current.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
});

describe("Tickets 목록 규모(브라우저, 0054)", () => {
  it("1000행 목록에서 화면에 보이는 행 근처만 그리고, 잘린 트래커 프로젝트를 알린다", async () => {
    await page.goto(`/tickets?ws=${workspaceId}`);
    await hydrated(page);
    await page.getByText(truncatedNotice("Web", "1,000"), { exact: true }).waitFor();
    const allTab = page.getByRole("tab", { name: tickets.filter.all });
    expect(await allTab.textContent()).toContain(String(trackerReadLimit));

    const list = page.getByRole("listbox", { name: tickets.listLabel });
    const options = list.getByRole("option");
    await options.first().waitFor();
    const viewportHeight = page.viewportSize()?.height ?? 0;
    const rowPitch = 54;
    const visibleRows = Math.ceil(viewportHeight / rowPitch);
    const mostRenderedRows = visibleRows + 2 * 6 + 1;
    await expect.poll(() => options.count()).toBeLessThanOrEqual(mostRenderedRows);
    expect(await options.count()).toBeGreaterThanOrEqual(5);
    await options.first().hover();
    await page.mouse.wheel(0, trackerReadLimit * rowPitch);
    await list
      .getByRole("option", { name: `ACME-${trackerReadLimit} Ticket number ${trackerReadLimit}` })
      .waitFor();
    expect(await options.count()).toBeLessThanOrEqual(mostRenderedRows);
    expect(await list.getByRole("option", { name: `ACME-${trackerReadLimit + 1} ` }).count()).toBe(
      0,
    );
  });

  it("화살표로 그리지 않은 행까지 옮겨 갈 수 있다", async () => {
    await page.goto(`/tickets?ws=${workspaceId}`);
    await hydrated(page);
    const list = page.getByRole("listbox", { name: tickets.listLabel });
    await list.getByRole("option").first().click();
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(50);
    }
    await expect.poll(() => page.locator(":focus").getAttribute("role")).toBe("option");
    await expect.poll(focused).toBe("ACME-41Ticket number 41WebTodo할당 전");
  });
});

describe("Tickets 수동 할당(브라우저, 0054)", () => {
  it("할당 전 필터에서 할당하면 창이 닫히고, 그 티켓을 고른 채 '런 보기'로 포커스가 간다", async () => {
    await page.goto(`/tickets?ws=${workspaceId}&f=unassigned`);
    await hydrated(page);
    const key = "ACME-1";
    const panel = page.getByRole("region", { name: tickets.panel.label });
    await panel.getByRole("heading", { name: `${key} Ticket number 1` }).waitFor();

    await panel.getByRole("button", { name: tickets.panel.assign }).click();
    const dialog = page.getByRole("dialog", { name: fill(tickets.assign.title, { key }) });
    await dialog.getByRole("button", { name: tickets.assign.submit }).click();

    await page
      .getByRole("region", { name: shell.toastRegion })
      .getByText(fill(tickets.assign.done, { key }))
      .waitFor();
    await dialog.waitFor({ state: "hidden" });
    await expect.poll(focused).toBe(tickets.panel.openRun);
    await panel.getByRole("heading", { name: `${key} Ticket number 1` }).waitFor();
    const list = page.getByRole("listbox", { name: tickets.listLabel });
    expect(await list.getByRole("option", { name: `${key} Ticket number 1` }).count()).toBe(0);
    expect(new URL(page.url()).searchParams.get("sel")).not.toBeNull();
  });

  it("보내는 중에는 Esc 나 취소로 창이 닫히지 않는다", async () => {
    await page.goto(`/tickets?ws=${workspaceId}`);
    await hydrated(page);
    const key = "ACME-2";
    await page
      .getByRole("listbox", { name: tickets.listLabel })
      .getByRole("option", { name: `${key} Ticket number 2` })
      .click();
    const panel = page.getByRole("region", { name: tickets.panel.label });
    await panel.getByRole("button", { name: tickets.panel.assign }).click();
    const dialog = page.getByRole("dialog", { name: fill(tickets.assign.title, { key }) });
    const held = holdNextServerCall(page);
    await dialog.getByRole("button", { name: tickets.assign.submit }).click();
    await held.arrived;
    await dialog.getByRole("button", { name: tickets.assign.submitting }).waitFor();

    await page.keyboard.press("Escape");
    await dialog.getByRole("button", { name: tickets.assign.cancel }).click();
    await page.waitForTimeout(300);
    expect(await dialog.isVisible()).toBe(true);
    await held.release();
    await page
      .getByRole("region", { name: shell.toastRegion })
      .getByText(fill(tickets.assign.done, { key }))
      .waitFor();
    await dialog.waitFor({ state: "hidden" });
    await expect.poll(focused).toBe(tickets.panel.openRun);
  });
});
function holdNextServerCall(target: Page): {
  arrived: Promise<void>;
  release: () => Promise<void>;
} {
  let arrive: () => void = () => {};
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  let held: Route | undefined;
  const pattern = "**/_serverFn/**";
  const handler = (route: Route) => {
    if (held !== undefined || route.request().method() !== "POST") {
      void route.continue();
      return;
    }
    held = route;
    arrive();
  };
  void target.route(pattern, handler);
  return {
    arrived,
    release: async () => {
      await held?.continue();
      await target.unroute(pattern, handler);
    },
  };
}

function truncatedNotice(project: string, count: string): string {
  return tickets.truncated.replace("{project}", project).replace("{limit, number}", count);
}

function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all);
}
async function focused(): Promise<string | null> {
  const active = page.locator(":focus");
  return (await active.count()) === 0 ? null : active.first().textContent();
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
  saveMapping(db, { connection, trackerProject, runnerProject, agent });
  saveAutoAssignLabel(db, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(db, {
    id: runnerId,
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 4,
  });
  recordRunnerCheck(db, {
    runnerId,
    online: true,
    checkedAt: new Date(),
    error: null,
    projects: [{ id: runnerProject, displayName: "acme/web", setupState: "ready" as const }],
    assignmentBlocked: false,
  });
}
async function hydrated(target: Page): Promise<void> {
  await target.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await target.waitForLoadState("networkidle");
}

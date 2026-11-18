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
} from "@factory/core";
import {
  SecretBox,
  migrate,
  openDatabase,
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
import type { Browser, Locator, Page } from "playwright-core";
import { createServer } from "vite";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import settings from "../../apps/web/messages/ko/settings.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const settingsAdaptersModule = fileURLToPath(new URL("./settings-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const encryptionKey = new Uint8Array(32).fill(7);

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;

const settingsAdapters: Plugin = {
  name: "e2e-settings-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? settingsAdaptersModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "factory-settings-"));
  const dbPath = join(dir, "factory.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);

  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  web = await createServer({
    root: webRoot,
    configFile: join(webRoot, "vite.config.ts"),
    logLevel: "warn",
    plugins: [settingsAdapters],
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
  });
  await web.listen();
  const address = web.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    throw new Error("web dev server has no TCP address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  browser = await chromium.launch({ channel: "chrome" });

  const warm = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  warm.setDefaultTimeout(110_000);
  await openSettings(warm, "general");
  await warm.close();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await web?.close();
  db?.$client.close();
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async (context) => {
  page = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  page.setDefaultTimeout(30_000);
  const current = page;
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await current.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
});

describe("Settings 포커스와 입력(브라우저, 0055)", () => {
  it("트래커 프로젝트를 넣으면 빼기 버튼에, 빼면 넣기 버튼에 포커스가 간다", async () => {
    await openSettings(page, "projects");
    const row = projectRow("API");

    await row.getByRole("button", { name: settings.projects.add }).click();
    await row.getByText(settings.projects.inThis).waitFor();
    await expect.poll(focused).toBe(settings.projects.remove);

    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: settings.projects.remove }).click();
    await row.getByText(settings.projects.inThis).waitFor({ state: "detached" });
    await expect.poll(focused).toBe(settings.projects.add);
  });

  it("값을 지우기만 해서는 오류가 보이지 않고 칸을 벗어나면 보인다", async () => {
    await openSettings(page, "general");
    const name = page.getByLabel(settings.general.name);
    const maxRun = page.getByLabel(settings.general.maxRun);

    await name.fill("");
    expect(await page.getByText(settings.general.nameInvalid).count()).toBe(0);
    await maxRun.focus();
    await page.getByText(settings.general.nameInvalid).waitFor();

    await maxRun.fill("");
    expect(await page.getByText(settings.general.maxRunInvalid).count()).toBe(0);
    await name.focus();
    await page.getByText(settings.general.maxRunInvalid).waitFor();

    await maxRun.fill("60");
    await page.getByText(settings.general.maxRunInvalid).waitFor({ state: "detached" });
  });

  it("러너 Capacity 도 칸을 벗어난 뒤에 오류를 보이고, 숫자 키보드를 쓴다", async () => {
    await openSettings(page, "runners");
    const capacity = page.getByLabel(settings.runners.capacity).first();
    expect(await capacity.getAttribute("inputmode")).toBe("numeric");
    await capacity.fill("");
    expect(await page.getByText(settings.runners.capacityInvalid).count()).toBe(0);
    await page.getByLabel(settings.runners.name).first().focus();
    await page.getByText(settings.runners.capacityInvalid).first().waitFor();
  });

  it("비밀값 칸은 새 비밀번호를 권하지 않고 비밀번호 관리자가 건너뛴다", async () => {
    await openSettings(page, "connections");
    const connectionSecrets = await secretAttributes();
    await openSettings(page, "github");
    const githubSecrets = await secretAttributes();

    expect(connectionSecrets.length).toBe(4);
    expect(githubSecrets.length).toBe(1);
    for (const secret of [...connectionSecrets, ...githubSecrets]) {
      expect(secret).toEqual({ autocomplete: "off", onePassword: true, lastPass: "true" });
    }
  });

  it("바꾼 값을 저장하지 않으면 편집 영역과 왼쪽 항목에 알린다", async () => {
    await openSettings(page, "general");
    expect(await page.getByText(settings.unsaved).count()).toBe(0);
    await page.getByLabel(settings.general.name).fill("Acme Shop");
    await page.getByRole("status").getByText(settings.unsaved).waitFor();
    await page
      .getByRole("listbox", { name: settings.workspaceListLabel })
      .getByText(settings.unsaved)
      .waitFor();
  });

  it("Runners 링크는 밑줄이 있고 라우터로 Workspace 를 이어 옮긴다", async () => {
    await openSettings(page, "runners");
    const link = page.getByRole("link", { name: settings.runners.toRunners, exact: true });
    expect(await link.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("underline");
    await page.evaluate(() => Object.assign(globalThis, { settingsPageMarker: true }));
    await link.click();
    await page.waitForURL(/\/runners\?.*ws=ws-acme/);
    expect(await page.evaluate(() => "settingsPageMarker" in globalThis)).toBe(true);
  });
});

async function secretAttributes(): Promise<
  Array<{ autocomplete: string | null; onePassword: boolean; lastPass: string | null }>
> {
  return page.locator('input[type="password"]').evaluateAll((inputs) =>
    inputs.map((input) => ({
      autocomplete: input.getAttribute("autocomplete"),
      onePassword: input.hasAttribute("data-1p-ignore"),
      lastPass: input.getAttribute("data-lpignore"),
    })),
  );
}

async function openSettings(target: Page, sel: string): Promise<void> {
  await target.goto(`/settings?ws=${workspaceId}&sel=${sel}`);
  await target.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await target.waitForLoadState("networkidle");
}

function projectRow(name: string): Locator {
  return page
    .getByRole("listitem")
    .filter({ hasText: name })
    .filter({ has: page.getByRole("button") });
}

async function focused(): Promise<string | null> {
  const active = page.locator(":focus");
  return (await active.count()) === 0 ? null : active.first().textContent();
}

function seed(target: Database): void {
  saveTrackerConnection(target, new SecretBox(encryptionKey), {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "lin_api_example" },
  });
  saveCodeHostConnection(target, new SecretBox(encryptionKey), {
    id: toCodeHostConnectionId("github"),
    kind: toCodeHostKind("github"),
    name: "github",
    config: {},
    secrets: { token: "github_pat_example" },
  });
  saveWorkspace(target, { id: workspaceId, name: "Acme" });
  saveWorkspaceTrackerProject(target, {
    workspaceId,
    connection,
    projectId: trackerProject,
    name: "Web",
    inProgressStateId: toTrackerStateId("in-progress"),
  });
  saveMapping(target, {
    connection,
    trackerProject,
    runnerProject: toRunnerProjectId("fake:acme/web"),
    agent: toAgentId("claude"),
  });
  saveAutoAssignLabel(target, { workspaceId, connection, labelId: toLabelId("factory") });
  saveRunner(target, {
    id: toRunnerId("runner-a"),
    kind: toRunnerKind("fake"),
    name: "runner-a",
    config: {},
    capacity: 8,
  });
}

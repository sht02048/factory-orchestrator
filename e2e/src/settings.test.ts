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
  getAutoAssignLabel,
  getMapping,
  migrate,
  openDatabase,
  recordRunnerCheck,
  replaceMapping,
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
import type { Browser, Locator, Page, Route } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import settings from "../../apps/web/messages/ko/settings.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";
import { startWebServer } from "./web-server.js";

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
  dir = mkdtempSync(join(tmpdir(), "ganger-settings-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  seed(db);

  process.env["DATABASE_PATH"] = dbPath;
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
  ({ server: web, baseUrl } = await startWebServer({
    plugins: [settingsAdapters],
    cacheDir: join(dir, "vite-cache"),
  }));

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

    const form = page.locator("form").filter({ has: name });

    await name.fill("");
    expect(await form.getByText(settings.general.nameInvalid).count()).toBe(0);
    await maxRun.focus();
    await form.getByText(settings.general.nameInvalid).waitFor();

    await maxRun.fill("");
    expect(await form.getByText(settings.general.maxRunInvalid).count()).toBe(0);
    await name.focus();
    await form.getByText(settings.general.maxRunInvalid).waitFor();

    await maxRun.fill("60");
    await form.getByText(settings.general.maxRunInvalid).waitFor({ state: "detached" });
  });

  it("러너 Capacity 도 칸을 벗어난 뒤에 오류를 보이고, 숫자 키보드를 쓴다", async () => {
    await openSettings(page, "runners");
    const form = page
      .locator("form")
      .filter({ has: page.getByLabel(settings.runners.capacity) })
      .first();
    const capacity = form.getByLabel(settings.runners.capacity);
    expect(await capacity.getAttribute("inputmode")).toBe("numeric");
    await capacity.fill("");
    expect(await form.getByText(settings.runners.capacityInvalid).count()).toBe(0);
    await form.getByLabel(settings.runners.name).focus();
    await form.getByText(settings.runners.capacityInvalid).waitFor();
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
    await unsavedStatus().waitFor();
    await page
      .getByRole("listbox", { name: settings.workspaceListLabel })
      .getByText(settings.unsaved)
      .waitFor();
  });

  it("서버가 다듬어 저장한 값도 저장한 뒤에는 바뀐 값으로 알리지 않는다", async () => {
    await openSettings(page, "general");
    await page.getByLabel(settings.general.name).fill("Acme ");
    await page.getByLabel(settings.general.maxRun).fill("060");
    await unsavedStatus().waitFor();
    await page.getByRole("button", { name: settings.save }).click();
    await unsavedStatus().waitFor({ state: "detached" });

    await openSettings(page, "addresses");
    await page.getByLabel(settings.addresses.webhook).fill("https://hooks.example.com/");
    await unsavedStatus().waitFor();
    await page.getByRole("button", { name: settings.addresses.save, exact: true }).click();
    await unsavedStatus().waitFor({ state: "detached" });
    expect(await page.getByLabel(settings.addresses.webhook).inputValue()).toBe(
      "https://hooks.example.com/",
    );
  });

  it("Runners 링크는 밑줄이 있고 라우터로 Workspace 를 이어 옮긴다", async () => {
    await openSettings(page, "runners");
    const link = page
      .getByRole("region", { name: settings.panelLabel })
      .getByRole("link", { name: settings.runners.toRunners, exact: true });
    expect(await link.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("underline");
    await page.evaluate(() => Object.assign(globalThis, { settingsPageMarker: true }));
    await link.click();
    await page.waitForURL(/\/runners\?.*ws=ws-acme/);
    expect(await page.evaluate(() => "settingsPageMarker" in globalThis)).toBe(true);
  });
});

describe("Mapping 여러 저장소와 즉시 저장(브라우저, 0115)", () => {
  beforeEach(() => resetMapping());

  it("저장소를 더하고 라벨을 붙이면 바로 저장하고 그 행에 저장했어요를 보인다", async () => {
    await openSettings(page, "mapping");
    await addRepo(page, "Web", "acme/api");
    await page.getByRole("status").getByText(settings.mapping.status.saved).first().waitFor();
    await expect
      .poll(() => savedRepos().map((r) => r.project))
      .toEqual(["fake:acme/web", "fake:acme/api"]);

    await pick(page, fill(settings.mapping.repoLabel, { repo: "acme/api" }), "api");
    await expect.poll(() => savedRepos()[1]?.labelId ?? null).toBe("label-api");

    await addRepo(page, "Web", "acme/infra");
    await page
      .getByRole("combobox", { name: fill(settings.mapping.repoLabel, { repo: "acme/infra" }) })
      .click();
    const used = page.getByRole("option", {
      name: fill(settings.mapping.labelUsed, { label: "api", repo: "acme/api" }),
    });
    expect(await used.getAttribute("aria-disabled")).toBe("true");
    await page.keyboard.press("Escape");

    await page
      .getByRole("button", { name: fill(settings.mapping.makeDefaultLabel, { repo: "acme/api" }) })
      .click();
    await expect
      .poll(() => savedRepos().find((r) => r.isDefault)?.project ?? null)
      .toBe("fake:acme/api");
    expect(savedRepos().find((r) => r.project === "fake:acme/api")?.labelId ?? null).toBeNull();
    await expect.poll(focused).toBe(settings.mapping.makeDefault);
  });

  it("저장하지 못하면 원래 값으로 되돌리고 이유를 그 행 아래에 보인다", async () => {
    await openSettings(page, "mapping");
    const fail = (route: Route) =>
      route.request().method() === "POST" ? route.abort() : route.continue();
    await page.route("**/_serverFn/**", fail);
    await addRepo(page, "Web", "acme/api");

    await page.getByRole("status").getByText(settings.mapping.status.reverted).waitFor();
    await page.getByRole("alert").getByText(settings.mapping.revertedRetry).waitFor();
    expect(
      await page
        .getByRole("button", { name: fill(settings.mapping.removeLabel, { repo: "acme/api" }) })
        .count(),
    ).toBe(0);
    expect(
      await page.evaluate(() => document.activeElement?.closest('[role="group"]') !== null),
    ).toBe(true);
    await page.unroute("**/_serverFn/**", fail);
    expect(savedRepos().map((r) => r.project)).toEqual(["fake:acme/web"]);
  });

  it("Linear에서 다시 읽으면 지금 값을 둔 채 새 값을 읽어 온다", async () => {
    await openSettings(page, "mapping");
    replaceMapping(db, {
      connection,
      trackerProject,
      agent: toAgentId("claude"),
      repos: [
        { project: toRunnerProjectId("fake:acme/web"), isDefault: true, labelId: null },
        { project: toRunnerProjectId("fake:acme/infra"), isDefault: false, labelId: null },
      ],
    });
    expect(await page.getByText("acme/infra", { exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: settings.mapping.reload }).first().click();
    await page.getByRole("status").getByText(settings.mapping.reloaded).first().waitFor();
    await page.getByText("acme/infra", { exact: true }).waitFor();
    await page.getByText("acme/web", { exact: true }).waitFor();
  });
});

describe("Auto-assign Label 만들기(브라우저, 0115)", () => {
  it("고른 라벨이 Linear에 없으면 알리고, ganger 라벨을 만들어 고른 뒤 첫 줄은 고르기가 된다", async () => {
    saveAutoAssignLabel(db, { workspaceId, connection, labelId: toLabelId("factory") });
    await openSettings(page, "label");
    await page.getByText(fill(settings.label.gone, { name: "ganger" })).waitFor();

    const select = fill(settings.label.selectFor, { connection: "Acme" });
    await pick(page, select, fill(settings.label.create, { name: "ganger" }));
    await expect
      .poll(() => getAutoAssignLabel(db, workspaceId, connection))
      .toBe("label-created-1");
    await page
      .getByText(fill(settings.label.gone, { name: "ganger" }))
      .waitFor({ state: "detached" });

    await page.getByRole("combobox", { name: select }).click();
    await page
      .getByRole("option", { name: fill(settings.label.pickExisting, { name: "ganger" }) })
      .waitFor();
    expect(
      await page
        .getByRole("option", { name: fill(settings.label.create, { name: "ganger" }) })
        .count(),
    ).toBe(0);
    await page.keyboard.press("Escape");
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

function unsavedStatus(): Locator {
  return page
    .getByRole("region", { name: settings.panelLabel })
    .getByRole("status")
    .getByText(settings.unsaved);
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
  recordRunnerCheck(target, {
    runnerId: toRunnerId("runner-a"),
    online: true,
    checkedAt: new Date(),
    error: null,
    assignmentBlocked: false,
    projects: ["web", "api", "infra"].map((name) => ({
      id: toRunnerProjectId(`fake:acme/${name}`),
      displayName: `acme/${name}`,
      setupState: "ready" as const,
    })),
  });
}

function resetMapping(): void {
  replaceMapping(db, {
    connection,
    trackerProject,
    agent: toAgentId("claude"),
    repos: [{ project: toRunnerProjectId("fake:acme/web"), isDefault: true, labelId: null }],
  });
}

function savedRepos() {
  return getMapping(db, connection, trackerProject)?.repos ?? [];
}

async function pick(target: Page, combobox: string, option: string): Promise<void> {
  await target.getByRole("combobox", { name: combobox }).click();
  await target.getByRole("option", { name: option, exact: true }).click();
}

async function addRepo(target: Page, project: string, repo: string): Promise<void> {
  await target.getByRole("button", { name: fill(settings.mapping.addLabel, { project }) }).click();
  await target.getByRole("menuitem", { name: repo, exact: true }).click();
}

function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all);
}

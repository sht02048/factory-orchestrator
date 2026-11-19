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
  saveInstallAddresses,
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
import runners from "../../apps/web/messages/ko/runners.json" with { type: "json" };
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

const lockedHost = "settings.example.test";
const projectPath = `/settings/projects/${connection}/${trackerProject}`;

const settingsAdapters: Plugin = {
  name: "e2e-settings-adapters",
  enforce: "pre",
  config: () => ({ server: { allowedHosts: true } }),
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

  browser = await chromium.launch({
    channel: "chrome",
    args: [`--host-resolver-rules=MAP ${lockedHost} 127.0.0.1`],
  });

  const warm = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  warm.setDefaultTimeout(110_000);
  await openSettings(warm);
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

describe("Settings 한 페이지(브라우저, 0119)", () => {
  it("목차를 누르면 그 구역으로 옮겨 제목에 포커스를 주고 지금 구역으로 표시한다", async () => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await openSettings(page);
    const nav = page.getByRole("navigation", { name: settings.nav.label });
    expect(await current(nav)).toBe(settings.sections.workspace);
    const before = page.url();

    await nav.getByRole("link", { name: settings.sections.advanced }).click();
    await expect.poll(focused).toBe(settings.sections.advanced);
    await expect.poll(() => current(nav)).toBe(settings.sections.advanced);
    expect(page.url()).toBe(before);

    await page.mouse.wheel(0, -5000);
    await expect.poll(() => current(nav)).toBe(settings.sections.workspace);
  });

  it("이름은 줄 안에서 펼쳐 바꾸고, 비우면 오류를 보이며, 닫으면 바꾸기로 포커스가 돌아온다", async () => {
    await openSettings(page);
    const workspace = section(settings.sections.workspace);
    await workspace.getByRole("button", { name: settings.change }).click();
    const name = workspace.getByRole("textbox", { name: settings.workspace.name, exact: true });
    await expect.poll(() => name.evaluate((el) => el === document.activeElement)).toBe(true);

    await name.fill("");
    await workspace.getByRole("button", { name: settings.save }).click();
    await workspace.getByText(settings.workspace.nameInvalid).waitFor();

    await page.keyboard.press("Escape");
    await name.waitFor({ state: "detached" });
    await expect.poll(focused).toBe(settings.change);
    await workspace.getByText("Acme", { exact: true }).filter({ visible: true }).waitFor();

    await workspace.getByRole("button", { name: settings.change }).click();
    await name.fill("Acme Shop");
    await workspace.getByRole("button", { name: settings.save }).click();
    await name.waitFor({ state: "detached" });
    await workspace.getByText("Acme Shop", { exact: true }).filter({ visible: true }).waitFor();
    await expect.poll(focused).toBe(settings.change);
    await page.getByText(settings.workspace.nameSaved).waitFor();
  });

  it("최대 실행 시간은 칸을 벗어나면 바로 저장하고, 맞지 않는 값은 저장하지 않고 알린다", async () => {
    await openSettings(page);
    const workspace = section(settings.sections.workspace);
    const minutes = workspace.getByRole("textbox", { name: settings.workspace.maxRunLabel });
    expect(await minutes.getAttribute("inputmode")).toBe("numeric");

    await minutes.fill("0");
    await workspace.getByRole("button", { name: settings.change }).focus();
    await workspace.getByText(settings.workspace.maxRunInvalid).waitFor();
    expect(await minutes.getAttribute("aria-invalid")).toBe("true");

    await minutes.fill("90");
    await minutes.press("Enter");
    await workspace.getByText(settings.status.saved).waitFor();
    expect(await workspace.getByText(settings.workspace.maxRunInvalid).count()).toBe(0);
    await page.reload();
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
    expect(await minutes.inputValue()).toBe("90");
  });

  it("바로 저장하는 스위치는 저장하지 못하면 원래 값으로 되돌리고 이유를 보인다", async () => {
    await openSettings(page, "/settings/mcp");
    const write = page.getByRole("switch", { name: settings.mcp.writeToggle });
    expect(await write.getAttribute("aria-checked")).toBe("false");

    await page.route("**/_serverFn/**", (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );
    await write.click();
    await page.getByText(settings.status.reverted, { exact: true }).waitFor();
    await page.getByRole("alert").getByText("저장하지 못해 되돌렸어요", { exact: false }).waitFor();
    expect(await write.getAttribute("aria-checked")).toBe("false");

    await page.unrouteAll();
    await write.click();
    await page.getByText(settings.status.saved, { exact: true }).waitFor();
    expect(await write.getAttribute("aria-checked")).toBe("true");
    await page.getByRole("main").getByRole("link", { name: settings.project.breadcrumb }).click();
    await section(settings.sections.advanced).getByText(settings.mcp.rowWrite).waitFor();
  });

  it("비밀값은 펼친 뒤에만 입력칸이 생기고, 새 비밀번호를 권하지 않고 비밀번호 관리자가 건너뛴다", async () => {
    await openSettings(page);
    expect(await page.locator('input[type="password"]').count()).toBe(0);
    const connections = section(settings.sections.connections);
    await connections.getByRole("button", { name: settings.connections.manage }).click();
    const connectionSecrets = await secretAttributes();
    expect(connectionSecrets.length).toBe(2);

    await connections.getByRole("button", { name: settings.change }).click();
    expect(
      await connections.getByRole("button", { name: settings.connections.manage }).count(),
    ).toBe(1);
    const githubSecrets = await secretAttributes();
    expect(githubSecrets.length).toBe(1);
    for (const secret of [...connectionSecrets, ...githubSecrets]) {
      expect(secret).toEqual({ autocomplete: "off", onePassword: true, lastPass: "true" });
    }
    await connections.getByRole("link", { name: settings.github.guideLink }).waitFor();
    await connections.getByRole("button", { name: settings.github.permissionsLabel }).hover();
    await page.getByRole("tooltip").getByText("Pull requests 읽기", { exact: false }).waitFor();
  });

  it("주소를 잘못 넣으면 그 줄에 이유를 보이고 저장하지 않는다", async () => {
    await openSettings(page);
    const server = section(settings.sections.server);
    await server.getByRole("button", { name: settings.addresses.set }).click();
    const address = server.getByRole("textbox", { name: settings.addresses.web, exact: true });
    await address.fill("server.example.ts.net/app");
    await server.getByRole("button", { name: settings.save }).click();
    await server
      .getByRole("alert")
      .getByText(settings.addresses.error["invalid-web-address"])
      .waitFor();
    await server.getByRole("button", { name: settings.close }).click();
    await server.getByText(settings.addresses.webNone).waitFor();
    await expect.poll(focused).toBe(settings.addresses.set);
  });

  it("지금 보는 주소가 막히는 값은 저장하지 않고 그 줄에서 경고한다", async () => {
    const port = new URL(baseUrl).port;
    saveInstallAddresses(
      db,
      { webAddress: `http://${lockedHost}:${port}`, webhookAddress: null },
      new Date(),
    );
    try {
      await page.goto(`http://${lockedHost}:${port}/settings?ws=${workspaceId}`);
      await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
      await page.waitForLoadState("networkidle");
      const server = section(settings.sections.server);
      await server.getByRole("button", { name: settings.change }).click();
      const address = server.getByRole("textbox", { name: settings.addresses.web, exact: true });
      await address.fill("https://other.example.ts.net");
      await server.getByRole("button", { name: settings.save }).click();
      await server.getByRole("alert").getByText(settings.addresses.error["locks-out"]).waitFor();
      expect(await address.inputValue()).toBe("https://other.example.ts.net");
      await shot(page, "settings-row-error-1280");
    } finally {
      saveInstallAddresses(db, { webAddress: null, webhookAddress: null }, new Date());
    }
  });

  it("서버가 다듬어 저장한 Webhook 주소를 줄에 보인다", async () => {
    await openSettings(page);
    const advanced = section(settings.sections.advanced);
    await advanced.getByRole("button", { name: settings.addresses.set }).click();
    await advanced
      .getByRole("textbox", { name: settings.addresses.webhook, exact: true })
      .fill("https://Hooks.example.com/");
    await advanced.getByRole("button", { name: settings.save }).click();
    await advanced.getByText("https://hooks.example.com", { exact: true }).waitFor();
    expect(await advanced.getByRole("textbox").count()).toBe(0);
    saveInstallAddresses(db, { webAddress: null, webhookAddress: null }, new Date());
  });

  it("프로젝트를 넣으면 새 줄로 포커스가 가고, 상세에서 빼면 Settings 로 돌아온다", async () => {
    await openSettings(page);
    const projects = section(settings.sections.projects);
    await projects.getByRole("button", { name: settings.projects.openLabel }).click();
    await projects.getByRole("button", { name: settings.projects.add }).click();
    await expect.poll(focused).toContain("API");

    await projects.getByRole("link", { name: /^API/ }).click();
    await page.waitForURL(/\/settings\/projects\/conn-acme\/tp-api/);
    await page.getByRole("heading", { level: 1, name: "API" }).waitFor();
    await page.getByRole("button", { name: settings.projects.remove }).click();
    await page.getByRole("dialog").getByRole("button", { name: settings.projects.remove }).click();
    await page.waitForURL((url) => url.pathname === "/settings");
    await section(settings.sections.projects).getByRole("link", { name: /^Web/ }).waitFor();
    await expect
      .poll(() => section(settings.sections.projects).getByRole("link", { name: /^API/ }).count())
      .toBe(0);
  });

  it("프로젝트 상세의 선택은 고르는 즉시 저장한다", async () => {
    await openSettings(page);
    await section(settings.sections.projects).getByRole("link", { name: /^Web/ }).click();
    await page.waitForURL(/\/settings\/projects\/conn-acme\/tp-web/);
    const crumb = page.getByRole("main").getByRole("link", { name: settings.project.breadcrumb });
    expect(await crumb.getAttribute("aria-current")).toBeNull();
    await shot(page, "settings-project-1280");
    const state = page.getByRole("combobox", { name: settings.project.state });
    await state.click();
    await page.getByRole("option", { name: "Todo", exact: true }).click();
    await page.getByText(settings.status.saved, { exact: true }).first().waitFor();
  });

  it("MCP 하위 화면은 클라이언트 설정을 탭으로 바꿔 보이고 위험을 도움말로 알린다", async () => {
    await openSettings(page);
    await section(settings.sections.advanced).getByRole("link", { name: /^MCP/ }).click();
    await page.waitForURL(/\/settings\/mcp/);
    await page.getByText("mcp_servers:", { exact: false }).waitFor();
    await page.getByRole("tab", { name: settings.mcp.json }).click();
    await page.getByText('"mcpServers"', { exact: false }).waitFor();
    await page.getByRole("button", { name: settings.mcp.writeRiskLabel }).hover();
    await page.getByRole("tooltip").getByText("확인을 받는지", { exact: false }).waitFor();
    expect(
      await page.getByRole("tab", { name: settings.mcp.json }).getAttribute("aria-selected"),
    ).toBe("true");
    await shot(page, "settings-mcp-1280");
  });

  it("400px 에서는 목차가 가로 칩 줄이 되고 가로로 넘치지 않는다", async () => {
    await page.setViewportSize({ width: 400, height: 900 });
    await openSettings(page);
    const nav = page.getByRole("navigation", { name: settings.nav.label });
    const first = await nav.getByRole("link", { name: settings.sections.workspace }).boundingBox();
    const second = await nav.getByRole("link", { name: settings.sections.projects }).boundingBox();
    expect(first?.y).toBe(second?.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      400,
    );
    await shot(page, "settings-400");
  });

  it("Runners 로 가는 러너 줄은 라우터로 Workspace 를 이어 옮긴다", async () => {
    await openSettings(page);
    await page.evaluate(() => Object.assign(globalThis, { settingsPageMarker: true }));
    await section(settings.sections.connections)
      .getByRole("link", { name: new RegExp(`^${settings.runnersRow.label}`) })
      .click();
    await page.waitForURL(/\/runners\?.*ws=ws-acme/);
    expect(await page.evaluate(() => "settingsPageMarker" in globalThis)).toBe(true);
  });
});

describe("Settings 폼과 도움말(브라우저, 0119 리뷰 후속)", () => {
  it("도움말 단추는 눌러도 열리고 다시 누르면 닫힌다", async () => {
    await openSettings(page);
    const tip = page.getByRole("button", { name: "최대 실행 시간 도움말" });
    await tip.click();
    await page.getByRole("tooltip").getByText("Failed 로 끝내요", { exact: false }).waitFor();
    await tip.click();
    await expect.poll(() => page.getByRole("tooltip").filter({ visible: true }).count()).toBe(0);
  });

  it("고친 값이 남은 줄이 펼쳐져 있으면 다른 줄을 펼치지 않고 알린다", async () => {
    await openSettings(page);
    const workspace = section(settings.sections.workspace);
    await workspace.getByRole("button", { name: settings.change }).click();
    const name = workspace.getByRole("textbox", { name: settings.workspace.name, exact: true });
    await name.fill("Acme Draft");
    await section(settings.sections.connections)
      .getByRole("button", { name: `${settings.github.label} ${settings.change}` })
      .click();
    await page.getByRole("alert").getByText(settings.unsavedBlocked).waitFor();
    expect(await name.inputValue()).toBe("Acme Draft");
    expect(await page.getByRole("textbox", { name: settings.github.token }).count()).toBe(0);
    await workspace.getByRole("button", { name: settings.close }).click();
    await section(settings.sections.connections)
      .getByRole("button", { name: `${settings.github.label} ${settings.change}` })
      .click();
    await page.getByRole("textbox", { name: settings.github.token }).waitFor();
  });

  it("비밀값을 비운 채 저장하면 버튼을 막지 않고 칸 아래에 무엇을 넣을지 알린다", async () => {
    await openSettings(page);
    const connections = section(settings.sections.connections);
    await connections.getByRole("button", { name: settings.connections.addLabel }).click();
    const submit = connections.getByRole("button", { name: settings.credentials.keyCheck });
    expect(await submit.isDisabled()).toBe(false);
    await submit.click();
    await connections.getByText(settings.credentials.keyRequired).waitFor();
    await page
      .getByRole("textbox", { name: settings.connections.apiKey, exact: true })
      .fill("lin_api");
    await connections.getByText(settings.credentials.keyRequired).waitFor({ state: "detached" });
  });

  it("맞지 않는 분 값은 넣은 값을 그대로 두고 오류를 그 칸에 잇는다", async () => {
    await openSettings(page);
    const minutes = page.getByRole("textbox", { name: settings.workspace.maxRunLabel });
    await minutes.fill("0");
    await minutes.press("Enter");
    await page.getByText(settings.workspace.maxRunInvalid).waitFor();
    expect(await minutes.inputValue()).toBe("0");
    const described = await minutes.getAttribute("aria-describedby");
    expect(await page.locator(`[id="${described}"]`).textContent()).toBe(
      settings.workspace.maxRunInvalid,
    );
    await minutes.fill("12");
    await page.getByText(settings.workspace.maxRunInvalid).waitFor({ state: "detached" });
    await page.reload();
  });

  it("+ 넣기를 누르면 넣을 프로젝트 목록의 첫 버튼으로 포커스가 간다", async () => {
    await openSettings(page);
    await section(settings.sections.projects)
      .getByRole("button", { name: settings.projects.openLabel })
      .click();
    await expect.poll(focused).toBe(settings.projects.add);
  });

  it("스위치 줄의 이름을 눌러도 스위치가 바뀐다", async () => {
    await openSettings(page, "/settings/mcp");
    const write = page.getByRole("switch", { name: settings.mcp.writeToggle });
    const before = await write.getAttribute("aria-checked");
    await page.locator("label", { hasText: settings.mcp.writeToggle }).click();
    await expect.poll(() => write.getAttribute("aria-checked")).not.toBe(before);
    await page.getByText(settings.status.saved, { exact: true }).waitFor();
    await write.click();
    await expect.poll(() => write.getAttribute("aria-checked")).toBe(before);
  });
});

describe("Runners 의 러너 고치기(브라우저, 0119)", () => {
  it("상세 패널에서 고치기를 눌러 줄 안에서 고치고, 닫으면 고치기로 포커스가 돌아온다", async () => {
    await openSettings(page, "/runners");
    await page
      .getByRole("button", { name: runners.panel.editLabel.replace("{name}", "runner-a") })
      .click();
    const capacity = page.getByRole("textbox", { name: settings.runners.capacity, exact: true });
    expect(await capacity.getAttribute("inputmode")).toBe("numeric");
    await capacity.fill("");
    await page.getByRole("textbox", { name: settings.runners.name, exact: true }).focus();
    await page.getByText(settings.runners.capacityInvalid).waitFor();
    await page.keyboard.press("Escape");
    await capacity.waitFor({ state: "detached" });
    await expect.poll(focused).toBe(runners.panel.edit);

    await page.getByRole("button", { name: runners.panel.edit }).click();
    await page.getByRole("textbox", { name: settings.runners.capacity, exact: true }).fill("4");
    await page
      .getByRole("textbox", { name: settings.runners.sshTarget, exact: true })
      .fill("ganger@runner-a.example.com");
    await page
      .getByRole("textbox", { name: settings.runners.orcaPath, exact: true })
      .fill("/opt/orca/bin/orca");
    await page.getByRole("button", { name: settings.runners.save }).click();
    await capacity.waitFor({ state: "detached" });
    await page.getByText(settings.runners.savedAndChecking).waitFor();
  });
});

async function current(nav: Locator): Promise<string | null> {
  const link = nav.locator('[aria-current="location"]');
  return (await link.count()) === 0 ? null : link.first().textContent();
}

function section(name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

async function shot(target: Page, name: string): Promise<void> {
  const dir = process.env["UPDATE_SCREENSHOTS"];
  if (dir === undefined) return;
  mkdirSync(dir, { recursive: true });
  await target.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}
describe("프로젝트 상세의 저장소 여러 개와 즉시 저장(브라우저, 0115·0119)", () => {
  beforeEach(() => resetMapping());

  it("저장소를 더하고 라벨을 붙이면 바로 저장하고 그 행에 저장했어요를 보인다", async () => {
    await openSettings(page, projectPath);
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
    await page
      .getByRole("status")
      .getByText(fill(settings.mapping.labelDropped, { repo: "acme/api", label: "api" }))
      .waitFor();
    await expect.poll(focused).toBe(settings.mapping.makeDefault);
  });

  it("저장하지 못하면 원래 값으로 되돌리고 이유를 그 행 아래에 보인다", async () => {
    await openSettings(page, projectPath);
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
    await openSettings(page, projectPath);
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

describe("프로젝트 상세의 Auto-assign Label 만들기(브라우저, 0115·0119)", () => {
  it("고른 라벨이 Linear에 없으면 알리고, ganger 라벨을 만들어 고른 뒤 첫 줄은 고르기가 된다", async () => {
    saveAutoAssignLabel(db, { workspaceId, connection, labelId: toLabelId("factory") });
    await openSettings(page, projectPath);
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

async function openSettings(target: Page, path = "/settings"): Promise<void> {
  await target.goto(`${path}?ws=${workspaceId}`);
  await target.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await target.waitForLoadState("networkidle");
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

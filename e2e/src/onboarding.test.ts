import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toCodeHostKind, toRunnerProjectId } from "@factory/core";
import type { RunnerHealth } from "@factory/core";
import {
  SecretBox,
  completeRunnerCheckRequest,
  listPendingRunnerCheckRequests,
  migrate,
  openDatabase,
  recordRunnerCheck,
  saveCodeHostConnection,
  toCodeHostConnectionId,
} from "@factory/db";
import type { Database } from "@factory/db";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import onboarding from "../../apps/web/messages/ko/onboarding.json" with { type: "json" };
import settings from "../../apps/web/messages/ko/settings.json" with { type: "json" };
import { startWebServer } from "./web-server.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const encryptionKey = new Uint8Array(32).fill(7);
const steps = onboarding.steps;

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;

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
  dir = mkdtempSync(join(tmpdir(), "factory-onboarding-"));
  const dbPath = join(dir, "factory.db");
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

describe("온보딩 포커스(브라우저, 0052)", () => {
  it("첫 트래커 연결을 만들면 포커스가 body 가 아니라 webhook 만들기 안내 제목에 간다", async () => {
    await open(1);
    await page.getByLabel(settings.connections.name).fill("Acme");
    await page.getByLabel(settings.connections.apiKey).fill("lin_api_example");
    await page.getByRole("button", { name: settings.connections.add }).click();

    await expect.poll(focused).toBe(onboarding.webhook.title);
  });

  it("키보드로 단계를 옮기면 새 단계 제목에 포커스가 가고, 완료한 단계는 이름에 완료를 갖는다", async () => {
    saveGitHubToken();
    await open(1);

    await page.getByRole("button", { name: onboarding.next, exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(/step=2/);
    await expect.poll(focused).toBe(steps.github.title);

    await page.getByRole("button", { name: onboarding.back }).focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(/step=1/);
    await expect.poll(focused).toBe(steps.tracker.title);

    const nav = page.getByRole("navigation", { name: onboarding.stepsLabel });
    const github = nav.getByRole("button", {
      name: `2 GitHub ${onboarding.stepDone}`,
      exact: true,
    });
    await github.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(/step=2/);
    await expect.poll(focused).toBe(steps.github.title);

    await nav
      .getByRole("button", { name: `1 Tracker ${onboarding.stepDone}`, exact: true })
      .waitFor();
  });

  it("첫 러너를 등록하면 포커스가 body 가 아니라 러너 확인 제목에 간다", async () => {
    await open(3);
    await page.getByLabel(settings.runners.name).fill("runner-a");
    await page.getByLabel(settings.runners.sshTarget).fill("factory@runner-a.example.com");
    await page.getByLabel(settings.runners.orcaPath).fill("/opt/orca/bin/orca");
    await page.getByRole("button", { name: settings.runners.add }).click();

    await expect.poll(focused).toBe("runner-a 러너");
  });

  it("첫 Workspace 를 만들면 토스트로 알리고 포커스가 새 Workspace 제목에 간다", async () => {
    finishRunnerCheck();
    await open(4);
    await page.getByLabel(onboarding.workspace.name).fill("Acme Commerce");
    await page.getByRole("button", { name: onboarding.workspace.create }).click();

    await expect.poll(focused).toBe("Acme Commerce Workspace");
    await page.getByText(onboarding.workspace.created).waitFor();
  });
});

async function open(step: number): Promise<void> {
  await page.goto(`/onboarding?step=${step}`);
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}

async function focused(): Promise<string | null> {
  const active = page.locator(":focus");
  return (await active.count()) === 0 ? null : active.first().textContent();
}

function saveGitHubToken(): void {
  saveCodeHostConnection(db, new SecretBox(encryptionKey), {
    id: toCodeHostConnectionId("github"),
    kind: toCodeHostKind("github"),
    name: "github",
    config: {},
    secrets: { token: "github_pat_example" },
  });
}

function finishRunnerCheck(): void {
  const request = listPendingRunnerCheckRequests(db)[0];
  if (request === undefined) throw new Error("no pending runner check");
  const now = new Date();
  const result: RunnerHealth = {
    online: true,
    version: "1.4.258",
    checkedAt: now,
    error: null,
    prerequisites: [
      {
        id: "orca-service",
        name: "Orca 상시 서비스",
        satisfied: true,
        hint: null,
        blocksAssignment: false,
      },
      {
        id: "push:acme/web",
        name: "acme/web GitHub 인증",
        satisfied: true,
        hint: null,
        blocksAssignment: true,
      },
    ],
  };
  completeRunnerCheckRequest(db, {
    runnerId: request.runnerId,
    requestedAt: request.requestedAt,
    completedAt: now,
    result,
  });
  recordRunnerCheck(db, {
    runnerId: request.runnerId,
    online: true,
    checkedAt: now,
    error: null,
    projects: [
      { id: toRunnerProjectId("github:acme/web"), displayName: "acme/web", setupState: "ready" },
    ],
    assignmentBlocked: false,
  });
}

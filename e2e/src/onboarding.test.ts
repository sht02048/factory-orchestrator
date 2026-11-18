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
import { createServer } from "vite";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import onboarding from "../../apps/web/messages/ko/onboarding.json" with { type: "json" };
import settings from "../../apps/web/messages/ko/settings.json" with { type: "json" };

/*
 * 온보딩의 키보드 포커스를 실제 브라우저로 확인하는 시험(티켓 0052).
 *
 * - 단계를 옮기면(다음·이전·단계 목록) 새 단계 제목에 포커스가 간다
 * - 첫 연결·첫 러너·첫 Workspace 를 만든 뒤 포커스가 body 로 떨어지지 않는다
 * - 완료한 단계는 접근성 이름에 "완료"를 갖는다
 *
 * 띄우는 방식은 operator-actions.test.ts(0039)와 같다. web 개발 서버의 server/adapters.ts 를 core 가짜 트래커
 * 등록표(browser/fake-adapters.ts)로 바꿔 끼워, 트래커 연결 확인이 가짜 트래커로 성공한다. 빈 DB 에서 시작하고
 * 시험은 차례로 단계를 하나씩 채운다. GitHub 토큰과 러너 확인 결과처럼 화면 밖에서 오는 값은 DB 에 직접 쓴다.
 * 가상 값만 쓴다(acme, example.com).
 */

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

/** web 의 server/adapters.ts 를 가짜 트래커 등록표로 바꾼다. 제품 코드는 고치지 않는다 */
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
  web = await createServer({
    root: webRoot,
    configFile: join(webRoot, "vite.config.ts"),
    logLevel: "warn",
    plugins: [fakeAdapters],
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
  });
  await web.listen();
  const address = web.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    throw new Error("web dev server has no TCP address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

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

    // 다음
    await page.getByRole("button", { name: onboarding.next, exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(/step=2/);
    await expect.poll(focused).toBe(steps.github.title);

    // 이전: 1단계에는 이전 버튼이 없어 누른 버튼이 빠진다
    await page.getByRole("button", { name: onboarding.back }).focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(/step=1/);
    await expect.poll(focused).toBe(steps.tracker.title);

    // 단계 목록: 누른 단계는 지금 단계가 되어 버튼이 빠진다
    const nav = page.getByRole("navigation", { name: onboarding.stepsLabel });
    // 완료한 단계는 체크 표시만 보이지만 접근성 이름에 번호와 완료를 갖는다
    const github = nav.getByRole("button", {
      name: `2 GitHub ${onboarding.stepDone}`,
      exact: true,
    });
    await github.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(/step=2/);
    await expect.poll(focused).toBe(steps.github.title);

    // 2단계에서는 완료한 Tracker 가 버튼이고 이름에 완료를 갖는다
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

    await expect.poll(focused).toBe(onboarding.runner.checkTitle);
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

/** 온보딩의 한 단계(1부터)를 열고 hydration 을 기다린다 */
async function open(step: number): Promise<void> {
  await page.goto(`/onboarding?step=${step}`);
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}

/** 포커스를 가진 요소의 글. body 에 떨어지면 :focus 인 요소가 없어 null 이다 */
async function focused(): Promise<string | null> {
  const active = page.locator(":focus");
  return (await active.count()) === 0 ? null : active.first().textContent();
}

/** GitHub 단계를 마친 것처럼 토큰을 쓴다. 가짜 어댑터 등록표에는 코드 호스트가 없어 화면으로 확인하지 않는다 */
function saveGitHubToken(): void {
  saveCodeHostConnection(db, new SecretBox(encryptionKey), {
    id: toCodeHostConnectionId("github"),
    kind: toCodeHostKind("github"),
    name: "github",
    config: {},
    secrets: { token: "github_pat_example" },
  });
}

/** worker 가 러너 확인을 마친 것처럼 결과를 쓴다(Q61) */
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

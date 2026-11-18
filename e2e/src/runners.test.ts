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
import type { Browser, Page } from "playwright-core";
import { createServer } from "vite";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import runners from "../../apps/web/messages/ko/runners.json" with { type: "json" };
import { connection, fakeKind, trackerProject, workspaceId } from "./browser/fixtures.js";

/*
 * Runners 카드의 브라우저 시험(티켓 0057).
 *
 * - 긴 프로젝트 이름의 확인 항목과 긴 러너 이름이 320px 카드에서 잘리지 않고 줄을 바꾼다.
 * - Home 의 Runner Issue 카드처럼 sel 로 러너를 골라 들어오면 그 카드에 포커스가 간다.
 *
 * 띄우는 방식은 operator-actions.test.ts(티켓 0039)와 같다: apps/web 의 vite 개발 서버 + 설치된 Chrome.
 * 공용 도우미(browser/*)는 읽기만 하고, 이 시험의 seed 와 서버 설정은 이 파일에 둔다. 가상 값만 쓴다.
 */

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const encryptionKey = new Uint8Array(32).fill(7);

/** 긴 이름의 러너. 카드 제목이 한 줄에 들어가지 않는다 */
const longRunnerName = "build-runner-with-a-very-long-name-for-the-acme-staging-cluster";
const longRunner = toRunnerId("runner-long");
/** 프로젝트 이름이 긴 GitHub push 확인 항목. "GitHub push 권한: {project}"의 끝이 잘리면 안 된다 */
const longProject = "acme/a-very-long-repository-name-that-does-not-fit-in-one-card-line";
const longProjectId = toRunnerProjectId(`github:${longProject}`);
/** sel 로 고르는 러너. 앞에 카드를 여럿 두어 스크롤해야 보이게 한다 */
const selectedRunner = toRunnerId("runner-z");
const fillerCount = 8;

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;

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
  dir = mkdtempSync(join(tmpdir(), "factory-runners-"));
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

describe("Runners 카드(브라우저, 0057)", () => {
  it("긴 프로젝트 이름의 확인 항목과 긴 러너 이름을 자르지 않고 줄을 바꾼다", async (context) => {
    const page = await openPage(context.task.name, { width: 420, height: 900 });
    await page.goto(`/runners?ws=${workspaceId}`);
    await hydrated(page);

    const card = page.getByRole("region", {
      name: runners.card.label.replace("{name}", longRunnerName),
    });
    const checkName = card.getByText(`GitHub push 권한: ${longProject}`, { exact: true });
    const title = card.getByRole("heading", { name: longRunnerName, exact: true });
    await checkName.waitFor();

    const cardBox = await card.boundingBox();
    expect(cardBox?.width ?? 0).toBeLessThan(longProject.length * 7);
    for (const [target, text] of [
      [checkName, `GitHub push 권한: ${longProject}`],
      [title, longRunnerName],
    ] as const) {
      const layout = await textLayout(page, text);
      expect(layout.whiteSpace).not.toBe("nowrap");
      expect(layout.textOverflow).not.toBe("ellipsis");
      expect(layout.overflowing).toBe(false);
      // 한 줄에 들어가지 않아 줄을 바꿨다
      expect(layout.lines).toBeGreaterThan(1);
      // 글 전체가 카드 안에 있다
      const box = await target.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
        (cardBox?.x ?? 0) + (cardBox?.width ?? 0),
      );
    }
  });

  it("sel 로 러너를 골라 들어오면 그 러너 카드로 스크롤하고 포커스를 옮긴다", async (context) => {
    const page = await openPage(context.task.name, { width: 420, height: 600 });
    await page.goto(`/runners?ws=${workspaceId}&sel=${selectedRunner}`);
    await hydrated(page);

    const cell = page.locator(`li#runner-${selectedRunner}`);
    // 포커스는 hydrate 뒤 effect 에서 옮긴다
    await expect
      .poll(async () => page.locator(":focus").getAttribute("id"))
      .toBe(`runner-${selectedRunner}`);
    expect(await cell.getAttribute("aria-current")).toBe("true");
    // 스크롤해 화면 안에 들어왔다
    expect(await cell.isVisible()).toBe(true);
    const box = await cell.boundingBox();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(600);
  });
});

interface TextLayout {
  whiteSpace: string;
  textOverflow: string;
  /** 글이 칸보다 넓어 넘쳤다(잘렸다) */
  overflowing: boolean;
  /** 줄 수 */
  lines: number;
}

/**
 * 글이 text 와 같은 요소의 계산된 줄바꿈·말줄임과 줄 수. e2e 는 DOM 타입을 싣지 않아 식을 문자열로
 * 넘기고, 돌아온 값은 경계에서 모양을 확인한다.
 */
async function textLayout(page: Page, text: string): Promise<TextLayout> {
  const raw: unknown = await page.evaluate(`(() => {
    const el = [...document.querySelectorAll("h2, span")].find(
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

/** 실패하면 화면을 찍는 새 페이지. 닫지 않는다: afterAll 의 browser.close() 가 함께 닫는다 */
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
  // 온보딩(0026)을 마친 설치로 둔다. GitHub 토큰이 없으면 모든 화면이 온보딩으로 간다
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

/** 서버 렌더한 화면에 React 가 붙을 때까지 기다린다. 붙기 전에 누르면 키 입력이 사라진다 */
async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}

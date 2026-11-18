import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import onboarding from "../../apps/web/messages/ko/onboarding.json" with { type: "json" };
import settings from "../../apps/web/messages/ko/settings.json" with { type: "json" };

/*
 * 개발 진입점 `pnpm dev` 실행 시험(티켓 0047). 실제 명령(node demo/src/main.ts)을 임시 개발 폴더로 띄워 본다.
 *
 * - 미리 채운 모드: 홈이 온보딩으로 돌려보내지 않고 200 을 준다.
 * - 온보딩 모드: 홈이 온보딩으로 보내고, 브라우저로 가짜 값을 채워 5단계를 마치면 홈이 열린다.
 * - SIGTERM 을 받으면 web 과 worker 를 내리고 포트를 닫는다.
 *
 * 브라우저는 e2e 처럼 설치된 Google Chrome 을 playwright-core 로 띄운다. 실패하면 화면을 e2e/test-results 에 남긴다.
 */

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const main = join(repoRoot, "demo/src/main.ts");
const resultsDir = join(repoRoot, "e2e/test-results");
const STARTUP_TIMEOUT_MS = 90_000;

interface Dev {
  url: string;
  output: () => string;
  stop: () => Promise<number | null>;
}

let devRoot: string;
let browser: Browser;

beforeAll(async () => {
  devRoot = mkdtempSync(join(tmpdir(), "factory-dev-"));
  browser = await chromium.launch({ channel: "chrome" });
});

afterAll(async () => {
  await browser?.close();
  if (devRoot !== undefined) rmSync(devRoot, { recursive: true, force: true });
});

describe("pnpm dev", () => {
  it("미리 채운 모드: 홈이 온보딩으로 보내지 않고 200 이고, SIGTERM 에 포트를 닫는다", async () => {
    const dev = await startDev([]);
    let code: number | null;
    try {
      for (const path of ["/", "/runs", "/runners", "/stats", "/tickets"]) {
        const response = await fetch(dev.url + path, { redirect: "manual" });
        expect([path, response.status]).toEqual([path, 200]);
      }
      const home = await (await fetch(dev.url + "/")).text();
      expect(home).toContain("ACME-2");
    } finally {
      code = await dev.stop();
    }
    expect(code).toBe(0);
    await expect(fetch(dev.url + "/")).rejects.toThrow("fetch failed");
  });

  it("온보딩 모드: 가짜 값으로 5단계를 마치면 홈이 열린다", async () => {
    const dev = await startDev(["--onboarding", "--static"]);
    const page = await browser.newPage({ baseURL: dev.url, locale: "ko-KR" });
    page.setDefaultTimeout(30_000);
    onTestFailed(async () => {
      mkdirSync(resultsDir, { recursive: true });
      await page.screenshot({ path: join(resultsDir, "dev-onboarding.png"), fullPage: true });
    });
    try {
      const first = await fetch(dev.url + "/", { redirect: "manual" });
      expect(first.status).toBe(307);
      expect(first.headers.get("location")).toContain("/onboarding");

      await page.goto("/");
      await hydrated(page);
      const fill = page.getByRole("button", { name: "가짜 값 채우기" });
      const next = page.getByRole("button", { name: onboarding.next });

      // 1. 트래커
      await fill.click();
      await page.getByRole("button", { name: settings.connections.add }).click();
      await page.getByText(settings.connections.added).waitFor();
      await next.click();
      // 2. GitHub 토큰
      await fill.click();
      await page.getByRole("button", { name: settings.github.save }).click();
      await enabled(next);
      await next.click();
      // 3. 러너: worker 가 가짜 러너를 확인한다
      await fill.click();
      await page.getByRole("button", { name: settings.runners.add }).click();
      await page.getByText(onboarding.runner.passed).waitFor();
      await next.click();
      // 4. Workspace 와 트래커 프로젝트
      await fill.click();
      await page.getByRole("button", { name: onboarding.workspace.create }).click();
      await page.getByRole("button", { name: settings.projects.add }).first().click();
      await enabled(next);
      await next.click();
      // 5. Mapping, "In Progress" 상태, Auto-assign Label
      const main = page.locator("main");
      const choose = async (index: number, option: string) => {
        await main.getByRole("combobox").nth(index).click();
        await page.getByRole("option", { name: option, exact: true }).click();
      };
      const save = main.getByRole("button", { name: settings.save });
      await choose(0, "acme/web");
      await choose(1, "Claude Code");
      await save.nth(0).click();
      await page.getByText(settings.saved).first().waitFor();
      await choose(2, "In Progress");
      await save.nth(1).click();
      await choose(3, "factory");
      await save.nth(2).click();
      const finish = page.getByRole("button", { name: onboarding.finish });
      await enabled(finish);
      await finish.click();
      await page.waitForURL((url) => !url.pathname.startsWith("/onboarding"));

      const home = await fetch(dev.url + "/", { redirect: "manual" });
      expect(home.status).toBe(200);
    } finally {
      await page.close();
      await dev.stop();
    }
  });
});

async function startDev(args: string[]): Promise<Dev> {
  const port = await freePort();
  const env: Record<string, string | undefined> = {
    ...process.env,
    FACTORY_DEV_DIR: devRoot,
    WEB_HOST: "127.0.0.1",
    WEB_PORT: String(port),
  };
  delete env["DATABASE_PATH"];
  delete env["ENCRYPTION_KEY"];
  const child: ChildProcess = spawn(process.execPath, [main, "--reset", ...args], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<number | null>((resolve) =>
    child.once("exit", (code) => resolve(code)),
  );
  let exitCode: number | null | undefined;
  void exited.then((code) => (exitCode = code));

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (!output.includes("Web is listening at")) {
    if (exitCode !== undefined) throw new Error(`pnpm dev exited with ${exitCode}\n${output}`);
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`pnpm dev did not start\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return {
    url: `http://127.0.0.1:${port}`,
    output: () => output,
    stop: async () => {
      if (exitCode === undefined) child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
      const code = await exited;
      clearTimeout(timer);
      return code;
    },
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function enabled(locator: ReturnType<Page["getByRole"]>): Promise<void> {
  await locator.and(locator.page().locator(":enabled")).waitFor();
}

/** 서버 렌더한 화면에 React 가 붙을 때까지 기다린다(e2e operator-actions.test.ts 와 같다) */
async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}

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
      for (const file of [".env.example"]) {
        const response = await fetch(`${dev.url}/@fs${join(repoRoot, file)}`);
        expect([file, response.status]).toEqual([file, 403]);
      }
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
      const main = page.locator("main");
      const fill = page.getByRole("button", { name: "가짜 값 채우기" });
      const next = page.getByRole("button", { name: onboarding.next });

      await fill.click();
      await page.getByRole("button", { name: onboarding.tracker.check }).click();
      await main.getByText(onboarding.tracker.checked).waitFor();
      await next.click();
      await fill.click();
      await page.getByRole("button", { name: settings.github.save }).click();
      await enabled(next);
      await next.click();
      await fill.click();
      await page.getByRole("button", { name: settings.runners.add }).click();
      await main.getByText(onboarding.runner.ready.replace("{name}", "runner-a")).waitFor();
      await next.click();
      await fill.click();
      await page.getByRole("checkbox", { name: "Web" }).click();
      await page.getByRole("button", { name: onboarding.workspace.create }).click();
      await enabled(next);
      await next.click();
      const choose = async (index: number, option: string) => {
        await main.getByRole("combobox").nth(index).click();
        await page.getByRole("option", { name: option, exact: true }).click();
      };
      await choose(0, "acme/web");
      await choose(1, "Claude Code");
      await choose(2, "In Progress");
      await choose(3, "factory");
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

async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.waitForLoadState("networkidle");
}

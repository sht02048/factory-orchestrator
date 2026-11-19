import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toCodeHostKind } from "@ganger/core";
import {
  SecretBox,
  listRunners,
  migrate,
  openDatabase,
  saveCodeHostConnection,
  saveTrackerConnection,
  toCodeHostConnectionId,
} from "@ganger/db";
import type { Database } from "@ganger/db";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { Plugin, ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import runnerSetup from "../../apps/web/messages/ko/runnerSetup.json" with { type: "json" };
import { connection, fakeKind } from "./browser/fixtures.js";
import { resetFakeThisMac } from "./browser/fake-this-mac.js";
import { resetFakeEnrollment } from "./browser/fake-enrollment.js";
import { startWebServer } from "./web-server.js";
import { probeIdentity } from "../../apps/desktop/src/core/identity.js";
import { RunnerEnrollmentFlow } from "../../apps/desktop/src/core/runner-enrollment.js";
import type { RunnerEnrollmentDeps } from "../../apps/desktop/src/core/runner-enrollment.js";
import {
  acceptOffer,
  fetchOffer,
  isServerMac,
  runSetupScript,
} from "../../apps/desktop/src/core/runner-offer.js";
import type { SavedServer } from "../../apps/desktop/src/core/remote.js";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));
const adaptersModule = join(webRoot, "src/server/adapters.ts");
const fakeAdaptersModule = fileURLToPath(new URL("./browser/fake-adapters.ts", import.meta.url));
const resultsDir = fileURLToPath(new URL("../test-results", import.meta.url));

const encryptionKey = new Uint8Array(32).fill(7);
const thisMac = runnerSetup.thisMac;
const command = runnerSetup.command;
const app = runnerSetup.app;
const HOST_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE2eOtherMacHostKey root@other-mac";

let dir: string;
let db: Database;
let web: ViteDevServer;
let baseUrl: string;
let browser: Browser;
let page: Page;

const fakeAdapters: Plugin = {
  name: "e2e-runner-setup-adapters",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.endsWith("/adapters")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved?.id === adaptersModule ? fakeAdaptersModule : null;
  },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ganger-runner-setup-"));
  const dbPath = join(dir, "ganger.db");
  db = openDatabase(dbPath);
  migrate(db);
  const box = new SecretBox(encryptionKey);
  saveTrackerConnection(db, box, {
    id: connection,
    kind: fakeKind,
    name: "Acme",
    config: {},
    secrets: { apiKey: "lin_api_example" },
  });
  saveCodeHostConnection(db, box, {
    id: toCodeHostConnectionId("github"),
    kind: toCodeHostKind("github"),
    name: "github",
    config: {},
    secrets: { token: "github_pat_example" },
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
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async (context) => {
  page = await browser.newPage({ baseURL: baseUrl, locale: "ko-KR" });
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const current = page;
  onTestFailed(async () => {
    mkdirSync(resultsDir, { recursive: true });
    const name = context.task.name.replace(/[^\p{L}\p{N}_-]+/gu, "-");
    await current.screenshot({ path: join(resultsDir, `${name}.png`), fullPage: true });
  });
});

async function focused(): Promise<string | null> {
  const active = page.locator(":focus");
  return (await active.count()) === 0 ? null : active.first().textContent();
}

describe("이 맥을 러너로(브라우저, 0095)", () => {
  it("원격 로그인이 켜질 때까지 기다렸다가 단계를 돌리고, 등록한 러너가 아래에 나타나며 포커스가 그 제목에 간다", async () => {
    const mac = resetFakeThisMac();
    await page.goto("/onboarding?step=3");
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);

    const facts = page.getByRole("region", { name: runnerSetup.server.title });
    await facts.getByText("studio-mac").waitFor();
    await facts.getByText(runnerSetup.server.remoteLoginOff).waitFor();

    const steps = page.getByRole("list", { name: runnerSetup.choose.stepsLabel });
    await steps.getByText("직접 해요: 원격 로그인 켜기").waitFor({ state: "attached" });
    expect(await steps.getByRole("listitem").count()).toBe(5);
    expect(
      await page.getByRole("radio", { name: /이 맥\(studio-mac\)에서 돌리기/ }).isChecked(),
    ).toBe(true);
    expect(await page.locator("details").count()).toBe(0);

    await page.getByRole("button", { name: runnerSetup.choose.continue }).click();
    await expect.poll(focused).toBe(thisMac.title);
    await page.getByText(thisMac.remoteLoginBody).waitFor();
    await page.getByText(thisMac.waiting).waitFor();
    expect(mac.ran).toEqual([]);

    const flow = page.getByRole("region", { name: thisMac.title });
    const flowTop = await flow.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);

    mac.remoteLogin = true;
    await expect.poll(focused, { timeout: 15_000 }).toBe("studio-mac 러너");
    expect(mac.ran).toEqual(["key", "hostKey", "service", "github", "register"]);
    await flow.getByText(thisMac.problem["gh-logged-out"]).waitFor();
    await page.getByRole("status").filter({ hasText: "studio-mac 러너를 등록했어요" }).waitFor();

    const after = await flow.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(after).toBe(flowTop);
    const result = page.getByRole("region", { name: "studio-mac 러너" });
    const resultTop = await result.evaluate((el) => el.getBoundingClientRect().top);
    const flowBottom = await flow.evaluate((el) => el.getBoundingClientRect().bottom);
    expect(resultTop).toBeGreaterThan(flowBottom);

    const [runner] = listRunners(db);
    expect(runner?.capacity).toBe(1);
    expect(runner?.config).toMatchObject({
      sshTarget: "ganger@localhost",
      access: { kind: "ganger" },
    });
  });

  it("주소 직접 입력하기는 주소로 화면을 바꾸고, 뒤로 가기·새로 고침·맥 고르기로에 맞게 포커스를 옮긴다", async () => {
    resetFakeThisMac();
    await page.goto("/onboarding?step=3");
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
    await page.getByText(runnerSetup.choose.question).waitFor();
    expect(
      await page.getByRole("radio", { name: /다른 맥 · 그 맥에 Ganger 앱이 있어요/ }).isDisabled(),
    ).toBe(false);
    expect(await page.getByRole("radio", { name: /다른 맥 · 터미널 명령으로/ }).isDisabled()).toBe(
      false,
    );

    const link = page.getByRole("link", { name: runnerSetup.choose.directLink });
    await link.click();
    await page.waitForURL(/direct=true/);
    await expect.poll(focused).toBe(runnerSetup.direct.title);
    expect(await page.getByText(runnerSetup.choose.question).count()).toBe(0);

    const target = page.getByRole("textbox", { name: "ssh 대상" });
    await target.fill("dev@mac-mini.example.com");
    expect(await page.getByRole("textbox", { name: "러너 이름" }).inputValue()).toBe("mac-mini");
    await page.getByText("ssh -o BatchMode=yes -- dev@mac-mini.example.com true").waitFor();
    expect(await page.getByRole("button", { name: "확인하고 등록" }).isEnabled()).toBe(true);
    expect(await page.getByRole("button", { name: "명령 복사" }).isEnabled()).toBe(true);
    expect(await page.getByRole("textbox", { name: "orca 실행 파일 경로" }).inputValue()).toBe(
      "/Applications/Orca.app/Contents/Resources/bin/orca",
    );

    await page.goBack();
    await page.getByText(runnerSetup.choose.question).waitFor();
    await expect.poll(focused).toBe(runnerSetup.choose.directLink + "→");

    await page.goForward();
    await page.getByText(runnerSetup.direct.title).waitFor();
    await page.reload();
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
    await page.getByText(runnerSetup.direct.title).waitFor();

    await page.getByRole("link", { name: runnerSetup.direct.back }).click();
    await page.waitForURL((url) => !url.search.includes("direct"));
    await expect.poll(focused).toBe(runnerSetup.choose.directLink + "→");
  });

  it("직접 입력으로 등록하면 그 러너가 아래에 나타난다", async () => {
    resetFakeThisMac();
    await page.goto("/onboarding?step=3&direct=true");
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
    await page.getByRole("textbox", { name: "ssh 대상" }).fill("dev@direct-mac.example.com");
    await page.getByRole("button", { name: "확인하고 등록" }).click();
    await expect
      .poll(() => listRunners(db).some((runner) => runner.name === "direct-mac"))
      .toBe(true);
    const runner = listRunners(db).find((r) => r.name === "direct-mac");
    expect(runner?.config).toMatchObject({
      sshTarget: "dev@direct-mac.example.com",
      orcaPath: "/Applications/Orca.app/Contents/Resources/bin/orca",
    });
    expect(runner?.config).not.toHaveProperty("access");
  });

  for (const direct of [false, true]) {
    it(`400px 에서도 ${direct ? "직접 입력" : "고르기"} 화면이 가로로 넘치지 않는다`, async () => {
      resetFakeThisMac();
      await page.setViewportSize({ width: 400, height: 844 });
      await page.goto(`/onboarding?step=3${direct ? "&direct=true" : ""}`);
      await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
      await page
        .getByText(direct ? runnerSetup.direct.title : runnerSetup.choose.question)
        .waitFor();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

function otherMac(root: string): { home: string; bin: string; orca: string } {
  const home = join(root, "home");
  const bin = join(root, "bin");
  const orca = join(root, "orca");
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const stub = (path: string, body: string) => {
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
  };
  stub(join(bin, "nc"), "exit 0");
  stub(join(bin, "scutil"), "printf 'other-mac\\n'");
  stub(join(bin, "tailscale"), `[ "$1" = ip ] && printf '100.64.0.9\\n'`);
  stub(join(bin, "plutil"), "cat >/dev/null; exit 1");
  stub(join(bin, "gh"), "exit 1");
  stub(orca, `printf '%s\\n' "$*" >>"${join(root, "orca.log")}"`);
  return { home, bin, orca };
}

function runCommandOn(
  mac: { home: string; bin: string; orca: string },
  root: string,
  commandLine: string,
) {
  const hostKeyFile = join(root, "host_key.pub");
  writeFileSync(hostKeyFile, `${HOST_KEY}\n`);
  const patched = commandLine.replace(
    / \| sh$/u,
    ` | sed -e "s#^DEFAULT_ORCA=.*#DEFAULT_ORCA='${mac.orca}'#" -e "s#^HOST_KEY_FILE=.*#HOST_KEY_FILE='${hostKeyFile}'#" | sh`,
  );
  return new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      "/bin/sh",
      ["-c", patched],
      {
        encoding: "utf8",
        timeout: 30_000,
        env: { HOME: mac.home, PATH: `${mac.bin}:/usr/bin:/bin` },
      },
      (error, stdout, stderr) => {
        resolve({
          status: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
          stdout,
          stderr,
        });
      },
    );
  });
}

async function openCommandFlow(path: string): Promise<string> {
  await page.goto(path);
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.getByText(runnerSetup.choose.question).waitFor();
  await page.getByRole("radio", { name: /다른 맥 · 터미널 명령으로/ }).check();
  const chips = page.getByRole("list", { name: runnerSetup.choose.stepsLabel });
  await chips.getByText("직접 해요: 명령 붙여 넣기").waitFor({ state: "attached" });
  await page.getByText(runnerSetup.choose.aboutCommand).waitFor();
  await page.getByRole("button", { name: runnerSetup.choose.continue }).click();
  await expect.poll(focused).toBe(command.title);
  const address = page.getByRole("textbox", { name: command.address.label });
  const code = page.getByRole("region", { name: command.commandLabel });
  await Promise.race([address.waitFor(), code.waitFor()]);
  if (await address.isVisible()) {
    await address.fill(baseUrl);
    await page.getByRole("button", { name: command.address.save }).click();
  }
  await code.waitFor();
  return (await code.textContent()) ?? "";
}

describe("다른 맥 · 명령으로 등록(브라우저, 0097)", () => {
  it("명령을 그 맥에서 실행하면 Ganger 관리 러너로 저장하고 화면이 등록을 알린다", async () => {
    resetFakeThisMac();
    const world = resetFakeEnrollment();
    const line = await openCommandFlow("/onboarding?step=3");
    expect(line).toMatch(/^curl -fsSL '.+\/api\/runner-enrollment\/script\?t=[\w-]+' \| sh$/u);
    await page.getByText(/\d+:\d\d 뒤 만료 · 한 번만 쓸 수 있어요/u).waitFor();

    const root = mkdtempSync(join(tmpdir(), "ganger-other-mac-"));
    try {
      const mac = otherMac(root);
      const ran = await runCommandOn(mac, root, line);
      expect([ran.status, ran.stderr]).toEqual([0, ""]);
      expect(ran.stdout).toContain("registered other-mac as a runner");
      expect(readFileSync(join(mac.home, ".ssh", "authorized_keys"), "utf8")).toContain(
        "AAAAC3NzaC1lZDI1NTE5AAAAIGangerKeyForE2e ganger",
      );
      expect(readFileSync(join(root, "orca.log"), "utf8")).toContain("serve service install");

      await page
        .getByRole("status")
        .filter({ hasText: "other-mac 러너를 등록했어요" })
        .waitFor({ timeout: 10_000 });
      await expect.poll(focused, { timeout: 10_000 }).toBe("other-mac 러너");
      const runner = listRunners(db).find((r) => r.name === "other-mac");
      expect(runner?.capacity).toBe(1);
      expect(runner?.config).toMatchObject({ access: { kind: "ganger" } });
      expect(JSON.stringify(runner?.config)).toMatch(/"sshTarget":"[\w.-]+@100\.64\.0\.9"/u);
      expect(world.ssh.pinned.get("100.64.0.9")?.body).toBe(
        "AAAAC3NzaC1lZDI1NTE5AAAAIE2eOtherMacHostKey",
      );

      const again = await runCommandOn(mac, root, line);
      expect(again.status).not.toBe(0);
      expect(again.stderr).toContain("expired or was already used");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("10분이 지난 명령은 거절하고, 새 명령 받기는 앞 명령을 버리고 포커스를 흐름 제목으로 옮긴다", async () => {
    resetFakeThisMac();
    const world = resetFakeEnrollment();
    const first = await openCommandFlow("/runners?sel=new");
    const token = /t=([\w-]+)/u.exec(first)?.[1] ?? "";
    world.clockOffsetMs = 10 * 60_000;
    await page.getByRole("status").filter({ hasText: command.expired }).waitFor();
    expect(await page.getByRole("region", { name: command.commandLabel }).count()).toBe(0);
    const late = await fetch(`${baseUrl}/api/runner-enrollment`, {
      method: "POST",
      body: new URLSearchParams({ token, outcome: "ready" }),
    });
    expect(late.status).toBe(410);
    expect(await late.text()).toContain("expired after 10 minutes");

    world.clockOffsetMs = 0;
    const renew = page.getByRole("button", { name: command.newCommand });
    await renew.click();
    const code = page.getByRole("region", { name: command.commandLabel });
    await code.waitFor();
    expect(await code.textContent()).not.toBe(first);
    await page.getByRole("status").filter({ hasText: command.newCommandReady }).waitFor();
    await expect.poll(focused).toBe(command.title);
    expect(await page.getByRole("button", { name: command.newCommand }).count()).toBe(0);
    const replaced = await fetch(`${baseUrl}/api/runner-enrollment/script?t=${token}`);
    expect(await replaced.text()).toMatch(/expired or was already used.*exit 1/u);
  });

  it("그 맥이 알린 실패를 이유와 함께 보인다", async () => {
    resetFakeThisMac();
    resetFakeEnrollment();
    const line = await openCommandFlow("/runners?sel=new");
    const token = /t=([\w-]+)/u.exec(line)?.[1] ?? "";
    const reported = await fetch(`${baseUrl}/api/runner-enrollment`, {
      method: "POST",
      body: new URLSearchParams({
        token,
        outcome: "failed",
        problem: "orca-not-found",
        detail: "",
      }),
    });
    expect(reported.status).toBe(200);
    await page.getByRole("status").filter({ hasText: command.problem["orca-not-found"] }).waitFor();
    expect(await page.getByRole("region", { name: command.commandLabel }).count()).toBe(0);
    await page.getByText(command.expiredHere).waitFor();
    expect(await page.getByRole("region", { name: runnerSetup.server.title }).count()).toBe(0);
  });

  it("400px 에서도 명령 화면이 가로로 넘치지 않는다", async () => {
    resetFakeThisMac();
    resetFakeEnrollment();
    await page.setViewportSize({ width: 400, height: 844 });
    await openCommandFlow("/onboarding?step=3");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  it("직접 입력에서 orca 경로를 비우면 ssh로 찾고, 닿지 않으면 저장하지 않고 이유를 보인다", async () => {
    resetFakeThisMac();
    await page.goto("/onboarding?step=3&direct=true");
    await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
    await page.getByRole("textbox", { name: "ssh 대상" }).fill("dev@nowhere.invalid");
    await page.getByRole("textbox", { name: "orca 실행 파일 경로" }).fill("");
    await page.getByRole("button", { name: "확인하고 등록" }).click();
    await page.getByRole("alert").filter({ hasText: "ssh로 그 맥에 들어가지 못해" }).waitFor({
      timeout: 30_000,
    });
    expect(listRunners(db).some((r) => r.name === "nowhere")).toBe(false);
  });
});

async function openAppFlow(path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => "__TSR_ROUTER__" in globalThis);
  await page.getByText(runnerSetup.choose.question).waitFor();
  await page.getByRole("radio", { name: /다른 맥 · 그 맥에 Ganger 앱이 있어요/ }).check();
  const chips = page.getByRole("list", { name: runnerSetup.choose.stepsLabel });
  await chips.getByText("직접 해요: 앱에서 등록 누르기").waitFor({ state: "attached" });
  await page.getByRole("button", { name: runnerSetup.choose.continue }).click();
  await expect.poll(focused).toBe(app.title);
  const address = page.getByRole("textbox", { name: command.address.label });
  const waiting = page.getByRole("status").filter({ hasText: app.waiting });
  await Promise.race([address.waitFor(), waiting.waitFor()]);
  if (await address.isVisible()) {
    await address.fill(baseUrl);
    await page.getByRole("button", { name: app.addressSave }).click();
  }
  await waiting.waitFor();
}

function otherMacApp(
  mac: { home: string; bin: string; orca: string },
  root: string,
  overrides: Partial<RunnerEnrollmentDeps> = {},
) {
  const hostKeyFile = join(root, "host_key.pub");
  writeFileSync(hostKeyFile, `${HOST_KEY}\n`);
  return new RunnerEnrollmentFlow({
    fetchOffer: (origin) => fetchOffer(origin),
    acceptOffer: (origin, id) => acceptOffer(origin, id),
    runScript: (script, onProgress) =>
      runSetupScript(script, onProgress, {
        shell: {
          command: "/bin/sh",
          args: [
            "-c",
            `sed -e "s#^DEFAULT_ORCA=.*#DEFAULT_ORCA='${mac.orca}'#" -e "s#^HOST_KEY_FILE=.*#HOST_KEY_FILE='${hostKeyFile}'#" | sh -s`,
          ],
        },
        env: { HOME: mac.home, PATH: `${mac.bin}:/usr/bin:/bin` },
      }),
    isServerMac: async () => false,
    onChange: () => undefined,
    ...overrides,
  });
}

async function connectedServer(): Promise<SavedServer> {
  const probed = await probeIdentity(baseUrl, 3_000);
  if (probed.kind !== "ours") throw new Error("the e2e server did not answer as Ganger");
  return { instanceId: probed.identity.instanceId, name: "mac-mini", url: baseUrl };
}

describe("다른 맥 · Ganger 앱으로 등록(브라우저, 0099)", () => {
  it("다른 맥의 앱에 요청이 뜨고, 앱이 등록하면 Ganger 관리 러너로 저장하고 서버 화면이 등록을 알린다", async () => {
    resetFakeThisMac();
    const world = resetFakeEnrollment();
    await openAppFlow("/onboarding?step=3");
    await page.getByText(/\d+:\d\d 뒤 만료 · 맥 한 대만 등록할 수 있어요/u).waitFor();

    const root = mkdtempSync(join(tmpdir(), "ganger-app-mac-"));
    try {
      const mac = otherMac(root);
      const server = await connectedServer();
      const first = otherMacApp(mac, root);
      const second = otherMacApp(mac, root);
      await first.tick(server);
      await second.tick(server);
      expect(first.state).toMatchObject({ server: "mac-mini", step: { phase: "ask" } });
      expect(second.state).toMatchObject({ step: { phase: "ask" } });

      await first.accept();
      expect(first.state?.step).toMatchObject({
        phase: "registered",
        progress: { done: ["remoteLogin", "key", "service", "github", "register"] },
      });
      await second.tick(server);
      expect(second.state?.step).toEqual({ phase: "gone", reason: "ended" });

      expect(readFileSync(join(mac.home, ".ssh", "authorized_keys"), "utf8")).toContain(
        "AAAAC3NzaC1lZDI1NTE5AAAAIGangerKeyForE2e ganger",
      );
      await page
        .getByRole("status")
        .filter({ hasText: "other-mac 러너를 등록했어요" })
        .waitFor({ timeout: 10_000 });
      const runner = listRunners(db).find((r) => r.name === "other-mac");
      expect(runner?.config).toMatchObject({ access: { kind: "ganger" } });
      expect(JSON.stringify(runner?.config)).toMatch(/"sshTarget":"[\w.-]+@100\.64\.0\.9"/u);
      expect(world.ssh.pinned.get("100.64.0.9")?.body).toBe(
        "AAAAC3NzaC1lZDI1NTE5AAAAIE2eOtherMacHostKey",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("두 앱이 동시에 등록을 누르면 한쪽만 받고, 다른 쪽은 다른 맥이 먼저 눌렀다고 보인다", async () => {
    resetFakeThisMac();
    resetFakeEnrollment();
    await openAppFlow("/runners?sel=new");
    const server = await connectedServer();
    const scripts: string[] = [];
    const quiet = {
      runScript: (script: string) => {
        scripts.push(script);
        return { cancel: () => undefined, finished: new Promise<never>(() => undefined) };
      },
    };
    const root = mkdtempSync(join(tmpdir(), "ganger-app-mac-"));
    try {
      const mac = otherMac(root);
      const apps = [otherMacApp(mac, root, quiet), otherMacApp(mac, root, quiet)];
      for (const one of apps) await one.tick(server);
      void Promise.all(apps.map((one) => one.accept()));
      await expect
        .poll(() =>
          apps.map((one) => one.state?.step.phase ?? "").sort((a, b) => a.localeCompare(b)),
        )
        .toEqual(["gone", "running"]);
      expect(apps.find((one) => one.state?.step.phase === "gone")?.state?.step).toEqual({
        phase: "gone",
        reason: "taken",
      });
      expect(scripts).toHaveLength(1);
      expect(scripts[0]).toMatch(/^GANGER_TOKEN='[\w-]+'$/mu);
      await page.getByRole("status").filter({ hasText: app.preparing }).waitFor();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("그 맥의 실패를 서버 화면에 보이고, 10분이 지난 요청은 앱에 뜨지 않는다", async () => {
    resetFakeThisMac();
    const world = resetFakeEnrollment();
    await openAppFlow("/runners?sel=new");
    const server = await connectedServer();
    const root = mkdtempSync(join(tmpdir(), "ganger-app-mac-"));
    const runnersBefore = listRunners(db).length;
    try {
      const mac = otherMac(root);
      writeFileSync(join(mac.home, ".ssh"), "not a folder");
      const failing = otherMacApp(mac, root);
      await failing.tick(server);
      await failing.accept();
      expect(failing.state?.step).toMatchObject({
        phase: "failed",
        progress: { problem: "authorized-keys-failed" },
      });
      await page
        .getByRole("status")
        .filter({ hasText: command.problem["authorized-keys-failed"] })
        .waitFor({ timeout: 10_000 });
      expect(listRunners(db)).toHaveLength(runnersBefore);

      await page.getByRole("button", { name: app.askAgain }).click();
      await expect.poll(focused).toBe(app.title);
      await page.getByRole("status").filter({ hasText: app.askedAgain }).waitFor();
      world.clockOffsetMs = 10 * 60_000;
      await page.getByRole("status").filter({ hasText: app.expired }).waitFor();
      const late = otherMacApp(mac, root);
      await late.tick(server);
      expect(late.state).toBeNull();
      expect(await fetchOffer(baseUrl)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("서버를 돌리는 맥의 앱에는 요청이 뜨지 않는다", async () => {
    resetFakeThisMac();
    resetFakeEnrollment();
    await openAppFlow("/runners?sel=new");
    const server = await connectedServer();
    expect(await fetchOffer(baseUrl)).not.toBeNull();
    const own = new RunnerEnrollmentFlow({
      fetchOffer: (origin) => fetchOffer(origin),
      acceptOffer: (origin, id) => acceptOffer(origin, id),
      runScript: () => {
        throw new Error("must not run");
      },
      isServerMac: (saved) =>
        isServerMac(saved, (origin, timeoutMs) => probeIdentity(origin, timeoutMs), [
          Number(new URL(baseUrl).port),
        ]),
      onChange: () => undefined,
    });
    await own.tick(server);
    expect(own.state).toBeNull();
  });

  it("토큰 없이 받는 끝점은 아무것도 하지 않고, 받기 전 요청에는 토큰이 없다", async () => {
    resetFakeThisMac();
    resetFakeEnrollment();
    await openAppFlow("/runners?sel=new");
    const runnersBefore = listRunners(db).length;
    const offered = await fetch(`${baseUrl}/api/runner-enrollment/offer`);
    expect(await offered.text()).toMatch(/^\{"offer":\{"id":"[0-9a-f-]+","expiresInMs":\d+\}\}$/u);
    const offer = await fetchOffer(baseUrl);
    const blank = await fetch(`${baseUrl}/api/runner-enrollment`, {
      method: "POST",
      body: new URLSearchParams({ outcome: "ready" }),
    });
    expect(blank.status).toBe(403);
    const crossSite = await fetch(`${baseUrl}/api/runner-enrollment/offer/accept`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example.com" },
      body: JSON.stringify({ id: offer?.id }),
    });
    expect(crossSite.status).toBe(403);
    expect((await fetchOffer(baseUrl))?.id).toBe(offer?.id);
    expect(listRunners(db)).toHaveLength(runnersBefore);
  });

  it("400px 에서도 Ganger 앱 화면이 가로로 넘치지 않는다", async () => {
    resetFakeThisMac();
    resetFakeEnrollment();
    await page.setViewportSize({ width: 400, height: 844 });
    await openAppFlow("/onboarding?step=3");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

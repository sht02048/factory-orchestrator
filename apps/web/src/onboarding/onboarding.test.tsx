import {
  AdapterRegistry,
  toCodeHostKind,
  toRunnerProjectId,
  toTrackerKind,
  toTrackerProjectId,
} from "@factory/core";
import type { RunnerHealth, RunnerId } from "@factory/core";
import { FakeCodeHost, FakeTracker } from "@factory/core/testing";
import {
  SecretBox,
  completeRunnerCheckRequest,
  listPendingRunnerCheckRequests,
  listRunners,
  listTrackerConnections,
  listWorkspaces,
  migrate,
  openDatabase,
  recordRunnerCheck,
} from "@factory/db";
import { describe, expect, it } from "vitest";
import {
  addTrackerProject,
  saveGitHubToken,
  saveMappingSetting,
  saveRunnerSetting,
  saveTrackerConnectionSetting,
} from "../settings/actions";
import { loadSettingsPage } from "../settings/load";
import type { SettingsContext } from "../settings/load";
import type { SettingsPage } from "../settings/model";
import { renderWithMessages } from "../testing/render";
import { createFirstWorkspace, isOnboardingComplete } from "./load";
import { onboardingMessages } from "./messages";
import {
  HOME_PATH,
  ONBOARDING_PATH,
  ONBOARDING_STEPS,
  onboardingRedirect,
  resolveStep,
  serviceInstallCommand,
  stepPassed,
  stepToPin,
} from "./model";
import type { OnboardingStep } from "./model";
import { OnboardingScreen } from "./onboarding-screen";
import type { OnboardingActions } from "./onboarding-screen";

/*
 * 온보딩(0026). 가상 값만 쓴다(acme, example.com).
 * 저장과 연결 확인은 Settings(0025)의 함수를 그대로 부르고, 트래커·코드 호스트는 가짜 어댑터를 쓴다.
 */

const now = new Date("2026-11-18T09:00:00Z");
const webProject = toTrackerProjectId("tp-web");
const repo = toRunnerProjectId("github:acme/web");
const orcaPath = "/opt/orca/bin/orca";

interface Fixture {
  context: SettingsContext;
  tracker: FakeTracker;
  codeHost: FakeCodeHost;
}

function fixture(): Fixture {
  const db = openDatabase(":memory:");
  migrate(db);
  const tracker = new FakeTracker(toTrackerKind("fake"));
  tracker.projects.push({ id: webProject, name: "Web", url: "https://tracker.example.com/web" });
  const codeHost = new FakeCodeHost(toCodeHostKind("fake-host"));
  const registry = new AdapterRegistry()
    .registerTracker({ kind: tracker.kind, create: () => tracker })
    .registerCodeHost({ kind: codeHost.kind, create: () => codeHost });
  return {
    context: { db, secretBox: new SecretBox(new Uint8Array(32).fill(7)), registry },
    tracker,
    codeHost,
  };
}

const page = (f: Fixture): Promise<SettingsPage> => loadSettingsPage(f.context, undefined);

const reject = () => Promise.reject(new Error("unused"));
const noopActions: OnboardingActions = {
  saveGeneral: reject,
  addProject: reject,
  removeProject: reject,
  saveMapping: reject,
  saveInProgress: reject,
  saveLabel: reject,
  saveConnection: reject,
  checkConnection: reject,
  saveGitHubToken: reject,
  checkGitHubToken: reject,
  saveRunner: reject,
  recheckRunner: reject,
  pollRunnerChecks: () => Promise.resolve(false),
  createWorkspace: reject,
};

function render(settings: SettingsPage, step: OnboardingStep): string {
  return renderWithMessages(
    <OnboardingScreen
      page={settings}
      index={ONBOARDING_STEPS.indexOf(step)}
      onStep={() => {}}
      onFinish={() => {}}
      actions={noopActions}
    />,
    onboardingMessages,
  );
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ");
}

/** 바닥의 다음(마지막 단계는 설정 마치기) 버튼 태그 */
function nextButton(html: string, label: string): string {
  const button = html.match(new RegExp(`<button[^>]*>${label}</button>`, "g"))?.at(-1);
  if (button === undefined) throw new Error(`no ${label} button`);
  return button;
}

const isDisabled = (button: string) => /\sdisabled(=""|\s|>)/.test(button);

async function connectTracker(f: Fixture): Promise<void> {
  expect(
    await saveTrackerConnectionSetting(
      f.context,
      { name: "Acme", apiKey: "lin_api_example", webhookSecret: "" },
      now,
    ),
  ).toEqual({ ok: true });
}

function registerRunner(f: Fixture): RunnerId {
  const saved = saveRunnerSetting(
    f.context,
    { name: "runner-a", sshTarget: "factory@runner-a.example.com", orcaPath, capacity: 2 },
    now,
  );
  if (!saved.ok) throw new Error(saved.reason);
  return saved.runnerId;
}

const health = (
  prerequisites: { service: boolean; push: boolean },
  online = true,
): RunnerHealth => ({
  online,
  version: "1.4.258",
  checkedAt: now,
  error: online ? null : { kind: "unreachable", detail: "ssh: connect timed out" },
  prerequisites: [
    {
      id: "orca-service",
      name: "Orca 상시 서비스",
      satisfied: prerequisites.service,
      hint: null,
      blocksAssignment: false,
    },
    {
      id: "push:acme/web",
      name: "acme/web GitHub 인증",
      satisfied: prerequisites.push,
      hint: null,
      blocksAssignment: true,
    },
  ],
});

/**
 * Orca 상시 서비스가 없을 때 runner-orca 가 돌려주는 모양. 런타임이 준비되지 않아 Offline(not-ready)이고,
 * 러너 쪽 프로젝트를 읽지 못해 GitHub 인증 조건은 없다.
 */
const serviceMissing: RunnerHealth = {
  online: false,
  version: "1.4.258",
  checkedAt: now,
  error: { kind: "not-ready", detail: "runtime state: stopped" },
  prerequisites: [
    {
      id: "orca-service",
      name: "Orca background service",
      satisfied: false,
      hint: null,
      blocksAssignment: false,
    },
  ],
};

/** worker 가 러너 확인을 마친 것처럼 결과를 쓴다(Q61) */
function finishCheck(f: Fixture, runnerId: RunnerId, result: RunnerHealth): void {
  const request = listPendingRunnerCheckRequests(f.context.db).find((r) => r.runnerId === runnerId);
  if (request === undefined) throw new Error("no pending request");
  completeRunnerCheckRequest(f.context.db, {
    runnerId,
    requestedAt: request.requestedAt,
    completedAt: now,
    result,
  });
  recordRunnerCheck(f.context.db, {
    runnerId,
    online: result.online,
    checkedAt: now,
    error: null,
    projects: result.online ? [{ id: repo, displayName: "acme/web", setupState: "ready" }] : null,
    assignmentBlocked: result.online ? !result.prerequisites.every((p) => p.satisfied) : null,
  });
}

describe("온보딩으로 보내기", () => {
  it("설정이 없는 DB 로 아무 화면에 들어가도 온보딩으로 간다", async () => {
    const f = fixture();
    const complete = isOnboardingComplete(f.context.db, f.context.secretBox);
    expect(complete).toBe(false);
    for (const path of [
      "/",
      "/tickets",
      "/runs",
      "/runs/run-1",
      "/runners",
      "/stats",
      "/settings",
      "/unknown",
    ]) {
      expect({ path, to: onboardingRedirect(path, complete) }).toEqual({
        path,
        to: ONBOARDING_PATH,
      });
    }
    // 온보딩 자신과 서버 경로(webhook), 디자인 시스템 미리보기는 보내지 않는다
    for (const path of ["/onboarding", "/api/webhooks/tracker/c-1", "/ds"]) {
      expect({ path, to: onboardingRedirect(path, complete) }).toEqual({ path, to: null });
    }
    // 처음 들어오면 첫 단계(트래커 연결)를 보인다
    expect(resolveStep(await page(f), undefined)).toBe(0);
  });
});

describe("확인이 실패한 단계", () => {
  it("트래커 연결 확인이 실패하면 저장하지 않고 다음으로 갈 수 없다", async () => {
    const f = fixture();
    f.tracker.connection = { ok: false, error: { kind: "unauthorized" } };
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { name: "Acme", apiKey: "lin_api_wrong", webhookSecret: "" },
        now,
      ),
    ).toEqual({ ok: false, reason: "unauthorized" });
    const settings = await page(f);
    expect(stepPassed(settings, "tracker")).toBe(false);
    expect(isDisabled(nextButton(render(settings, "tracker"), "다음"))).toBe(true);
    // 주소로 뒤 단계를 골라도 끝내지 않은 단계에 머문다
    expect(resolveStep(settings, 4)).toBe(0);
  });

  it("GitHub 토큰 확인이 실패하면 다음으로 갈 수 없다", async () => {
    const f = fixture();
    await connectTracker(f);
    f.codeHost.connection = { ok: false, error: { kind: "unauthorized" } };
    expect(await saveGitHubToken(f.context, { token: "github_pat_wrong" }, now)).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    const settings = await page(f);
    expect(resolveStep(settings, 3)).toBe(1);
    expect(isDisabled(nextButton(render(settings, "github"), "다음"))).toBe(true);
  });

  async function runnerStep(result: RunnerHealth | null) {
    const f = fixture();
    await connectTracker(f);
    expect(await saveGitHubToken(f.context, { token: "github_pat_example" }, now)).toEqual({
      ok: true,
    });
    const runnerId = registerRunner(f);
    if (result !== null) finishCheck(f, runnerId, result);
    const settings = await page(f);
    return { settings, html: render(settings, "runner") };
  }

  it("러너 확인을 기다리는 동안에는 다음으로 갈 수 없다", async () => {
    const { settings, html } = await runnerStep(null);
    expect(stepPassed(settings, "runner")).toBe(false);
    expect(isDisabled(nextButton(html, "다음"))).toBe(true);
    expect(text(html)).toContain("확인 결과를 기다리고 있어요");
  });

  it("Orca 상시 서비스가 없으면 설치 명령을 안내하고 다음으로 갈 수 없다", async () => {
    const { settings, html } = await runnerStep(serviceMissing);
    expect(stepPassed(settings, "runner")).toBe(false);
    expect(resolveStep(settings, 5)).toBe(2);
    expect(isDisabled(nextButton(html, "다음"))).toBe(true);
    const shown = text(html);
    expect(shown).toContain("Orca 상시 서비스가 없어요");
    // PATH 에 orca 가 없어도 되게 등록한 경로를 --command 로 넣는다. --supervise 는 없다
    expect(serviceInstallCommand(orcaPath)).toBe(
      "/opt/orca/bin/orca serve service install --bind 127.0.0.1 --refuse-public --command /opt/orca/bin/orca",
    );
    expect(shown).toContain(serviceInstallCommand(orcaPath));
    expect(serviceInstallCommand("/opt/my tools/orca")).toBe(
      "'/opt/my tools/orca' serve service install --bind 127.0.0.1 --refuse-public --command '/opt/my tools/orca'",
    );
    // Offline 이어도 원인을 아는 경우에는 닿지 않았다는 일반 안내 대신 원인을 보인다
    expect(shown).not.toContain("ssh 대상과 orca 실행 파일 경로를 확인하고");
    expect(shown).not.toContain("--supervise");
    expect(shown).not.toContain("러너의 GitHub 인증이 안 돼요");
  });

  it("러너의 GitHub 인증이 안 되면 원인과 해결 방법을 보이고 다음으로 갈 수 없다", async () => {
    const { settings, html } = await runnerStep(health({ service: true, push: false }));
    expect(stepPassed(settings, "runner")).toBe(false);
    expect(isDisabled(nextButton(html, "다음"))).toBe(true);
    const shown = text(html);
    expect(shown).toContain("러너의 GitHub 인증이 안 돼요");
    expect(shown).toContain("git push --dry-run");
    expect(shown).toContain("macOS 키체인이 잠겨");
    expect(shown).toContain("GitHub용 ssh 키");
    expect(shown).toContain("gh auth login --insecure-storage");
    expect(shown).toContain("gh auth setup-git");
    expect(shown).not.toContain("Orca 상시 서비스가 없어요");
  });

  it("러너에 닿지 않으면 다음으로 갈 수 없다", async () => {
    const { settings, html } = await runnerStep(health({ service: true, push: true }, false));
    expect(stepPassed(settings, "runner")).toBe(false);
    expect(isDisabled(nextButton(html, "다음"))).toBe(true);
    expect(text(html)).toContain("러너에 닿지 않았어요");
  });

  it("러너에 닿았지만 확인 중 오류가 나면 다음으로 갈 수 없다", async () => {
    // runner-orca 는 러너 쪽 프로젝트를 읽지 못하면 GitHub 인증을 확인하지 않고 오류와 함께 돌려준다
    const { settings, html } = await runnerStep({
      ...serviceMissing,
      online: true,
      error: { kind: "runner-error", code: "repo_list_failed", message: "project list failed" },
      prerequisites: [{ ...serviceMissing.prerequisites[0]!, satisfied: true }],
    });
    expect(stepPassed(settings, "runner")).toBe(false);
    expect(isDisabled(nextButton(html, "다음"))).toBe(true);
    expect(text(html)).toContain("러너 확인 중 오류가 났어요");
  });

  it("GitHub 인증을 확인한 프로젝트가 없으면 다음으로 갈 수 없다", async () => {
    const result = health({ service: true, push: true });
    const { settings, html } = await runnerStep({
      ...result,
      prerequisites: result.prerequisites.map((p) =>
        p.blocksAssignment ? { ...p, satisfied: null } : p,
      ),
    });
    expect(stepPassed(settings, "runner")).toBe(false);
    expect(isDisabled(nextButton(html, "다음"))).toBe(true);
    expect(text(html)).toContain("GitHub 인증을 아직 확인하지 못했어요");
  });

  it("러너 확인이 성공하면 다음으로 갈 수 있다", async () => {
    const { settings, html } = await runnerStep(health({ service: true, push: true }));
    expect(stepPassed(settings, "runner")).toBe(true);
    expect(isDisabled(nextButton(html, "다음"))).toBe(false);
  });
});

describe("다섯 단계를 마치기", () => {
  it("다섯 단계를 마치면 홈으로 가고, 그 뒤에는 온보딩이 뜨지 않는다", async () => {
    const f = fixture();
    const reached = async () => resolveStep(await page(f), undefined);

    await connectTracker(f);
    expect(await reached()).toBe(1);

    expect(await saveGitHubToken(f.context, { token: "github_pat_example" }, now)).toEqual({
      ok: true,
    });
    expect(await reached()).toBe(2);

    const runnerId = registerRunner(f);
    finishCheck(f, runnerId, health({ service: true, push: true }));
    expect(await reached()).toBe(3);

    expect(createFirstWorkspace(f.context.db, { name: "Acme Commerce" }, now)).toEqual({
      ok: true,
    });
    // 두 번 만들어도 첫 Workspace 하나다
    expect(createFirstWorkspace(f.context.db, { name: "Acme Again" }, now)).toEqual({ ok: true });
    const workspaces = listWorkspaces(f.context.db);
    expect(workspaces.map((w) => w.name)).toEqual(["Acme Commerce"]);
    const ws = workspaces[0]?.id ?? "";
    const connectionId = listTrackerConnections(f.context.db, f.context.secretBox)[0]?.id ?? "";
    // Workspace 만 만들고 트래커 프로젝트를 넣지 않으면 넘어가지 않는다
    expect(await reached()).toBe(3);
    const project = { ws, connectionId, projectId: webProject };
    expect(addTrackerProject(f.context, { ...project, name: "Web" })).toEqual({ ok: true });
    expect(await reached()).toBe(4);

    // 마지막 단계는 Mapping 을 저장하기 전에는 마칠 수 없다
    expect(isDisabled(nextButton(render(await page(f), "mapping"), "설정 마치기"))).toBe(true);
    expect(isOnboardingComplete(f.context.db, f.context.secretBox)).toBe(false);

    expect(
      saveMappingSetting(f.context, { ...project, runnerProjectId: repo, agentId: "claude" }),
    ).toEqual({ ok: true });
    const settings = await page(f);
    expect(ONBOARDING_STEPS.every((step) => stepPassed(settings, step))).toBe(true);
    expect(isDisabled(nextButton(render(settings, "mapping"), "설정 마치기"))).toBe(false);
    expect(HOME_PATH).toBe("/");

    // 마친 뒤에는 어느 화면에 들어가도 온보딩으로 보내지 않는다
    const complete = isOnboardingComplete(f.context.db, f.context.secretBox);
    expect(complete).toBe(true);
    for (const path of ["/", "/runs", "/settings"]) {
      expect({ path, to: onboardingRedirect(path, complete) }).toEqual({ path, to: null });
    }
    // 러너가 나중에 Offline 이 돼도 온보딩으로 돌아가지 않는다
    recordRunnerCheck(f.context.db, {
      runnerId,
      online: false,
      checkedAt: now,
      error: null,
      projects: null,
      assignmentBlocked: null,
    });
    expect(listRunners(f.context.db)[0]?.online).toBe(false);
    expect(isOnboardingComplete(f.context.db, f.context.secretBox)).toBe(true);
  });

  it("이전 단계로 돌아갈 수 있다", async () => {
    const f = fixture();
    await connectTracker(f);
    expect(await saveGitHubToken(f.context, { token: "github_pat_example" }, now)).toEqual({
      ok: true,
    });
    const settings = await page(f);
    expect(resolveStep(settings, 1)).toBe(0);
    expect(text(render(settings, "github"))).toContain("이전");
    expect(text(render(settings, "tracker"))).not.toContain("이전");
  });

  it("트래커 연결을 마치면 webhook 경로와 만드는 방법을 안내한다", async () => {
    const f = fixture();
    await connectTracker(f);
    const settings = await page(f);
    const connection = settings.install.connections[0];
    if (connection === undefined) throw new Error("no connection");
    const shown = text(render(settings, "tracker"));
    expect(shown).toContain("Linear에서 webhook 만들기");
    expect(shown).toContain("Issues");
    expect(render(settings, "tracker")).toContain(connection.webhookPath);
  });

  it("단계 없는 주소로 들어와 트래커 연결을 저장하면 1단계에 머물고 webhook 경로가 보인다", async () => {
    const f = fixture();
    // 단계 없는 주소(/onboarding)로 들어오면 라우트가 지금 단계(1)를 주소에 넣어 다시 보낸다
    const step = stepToPin(await page(f), undefined);
    expect(step).toBe(1);
    expect(stepToPin(await page(f), step ?? undefined)).toBeNull();

    // 저장하면 화면 값을 다시 읽는다. 주소에 남은 단계로 고르므로 2단계로 넘어가지 않는다
    await connectTracker(f);
    const settings = await page(f);
    const index = resolveStep(settings, step ?? undefined);
    expect(index).toBe(0);
    expect(stepToPin(settings, step ?? undefined)).toBeNull();
    const connection = settings.install.connections[0];
    if (connection === undefined) throw new Error("no connection");
    const html = render(settings, ONBOARDING_STEPS[index] ?? "github");
    expect(text(html)).toContain("Linear에서 webhook 만들기");
    expect(html).toContain(connection.webhookPath);
    // 다음으로 가는 것은 운영자가 다음을 눌러서다
    expect(isDisabled(nextButton(html, "다음"))).toBe(false);
  });

  it("갈 수 없는 뒤 단계 주소로 들어와도 보이는 단계를 주소에 넣어, 저장 뒤 1단계에 머문다", async () => {
    const f = fixture();
    // /onboarding?step=3 으로 들어오면 1단계를 보이고 주소도 1단계로 바꾼다
    const step = stepToPin(await page(f), 3);
    expect(step).toBe(1);
    await connectTracker(f);
    expect(resolveStep(await page(f), step ?? undefined)).toBe(0);
  });

  it("signing secret 없이 저장한 연결이면 1단계에 그 사실을 알리고, 다음으로 가는 것은 막지 않는다", async () => {
    const f = fixture();
    await connectTracker(f);
    const withoutSecret = await page(f);
    expect(withoutSecret.install.connections[0]?.hasWebhookSecret).toBe(false);
    const html = render(withoutSecret, "tracker");
    expect(text(html)).toContain("아직 signing secret이 없어요");
    expect(text(html)).toContain("서명 검증에 실패");
    expect(isDisabled(nextButton(html, "다음"))).toBe(false);

    // webhook 을 만든 뒤 signing secret 을 넣고 저장하면 알림이 사라진다
    const id = withoutSecret.install.connections[0]?.id ?? "";
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { id, name: "Acme", apiKey: "", webhookSecret: "lin_wh_example" },
        now,
      ),
    ).toEqual({ ok: true });
    const withSecret = await page(f);
    expect(withSecret.install.connections[0]?.hasWebhookSecret).toBe(true);
    const shown = text(render(withSecret, "tracker"));
    expect(shown).not.toContain("아직 signing secret이 없어요");
    expect(shown).toContain("signing secret을 저장했어요");
  });
});

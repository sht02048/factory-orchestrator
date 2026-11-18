import {
  AdapterRegistry,
  toAgentId,
  toCodeHostKind,
  toLabelId,
  toRunnerKind,
  toRunnerProjectId,
  toTicketKey,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
} from "@factory/core";
import type { RunnerHealth, RunnerId, TrackerConnectionId } from "@factory/core";
import { FakeCodeHost, FakeTracker } from "@factory/core/testing";
import {
  SecretBox,
  assignRun,
  completeRunnerCheckRequest,
  listPendingRunnerCheckRequests,
  listRunners,
  listTrackerConnections,
  migrate,
  openDatabase,
  recordRunnerCheck,
  saveRunner,
  saveWorkspace,
  schema,
  toWorkspaceId,
} from "@factory/db";
import { describe, expect, it } from "vitest";
import { renderWithMessages } from "../testing/render";
import {
  addTrackerProject,
  removeTrackerProject,
  requestRunnerCheckSetting,
  saveGeneral,
  saveAddresses,
  saveGitHubToken,
  saveInProgressState,
  saveLabel,
  saveMappingSetting,
  saveRunnerSetting,
  runnerInput,
  saveTrackerConnectionSetting,
  mappingInput,
} from "./actions";
import { hasPendingRunnerChecks, loadSettingsPage } from "./load";
import type { SettingsContext } from "./load";
import { settingsMessages } from "./messages";
import type { SettingsItem, SettingsPage } from "./model";
import { SettingsScreen } from "./settings-screen";
import type { SettingsActions } from "./settings-screen";

/*
 * Settings(0025). 가상 값만 쓴다(acme, example.com).
 * 트래커·코드 호스트는 가짜 어댑터 하나를 등록표에 넣어 쓴다. 넘겨받은 설정은 기록한다.
 */

const now = new Date("2026-11-17T09:00:00Z");
const commerce = toWorkspaceId("ws-commerce");
const labs = toWorkspaceId("ws-labs");
const webProject = toTrackerProjectId("tp-web");
const labProject = toTrackerProjectId("tp-lab");
const repo = toRunnerProjectId("github:acme/web");

interface Fixture {
  context: SettingsContext;
  tracker: FakeTracker;
  codeHost: FakeCodeHost;
  /** 어댑터를 만들 때 받은 설정 */
  trackerConfigs: unknown[];
}

function fixture(): Fixture {
  const db = openDatabase(":memory:");
  migrate(db);
  saveWorkspace(db, { id: commerce, name: "Acme Commerce" }, now);
  saveWorkspace(db, { id: labs, name: "Acme Labs" }, new Date(now.getTime() + 1));

  const tracker = new FakeTracker(toTrackerKind("fake"));
  tracker.projects.push(
    { id: webProject, name: "Web", url: "https://tracker.example.com/web" },
    { id: labProject, name: "Lab", url: "https://tracker.example.com/lab" },
  );
  tracker.states.set(webProject, [
    { id: toTrackerStateId("st-todo"), name: "Todo", category: "unstarted" },
    { id: toTrackerStateId("st-doing"), name: "In Progress", category: "started" },
  ]);
  tracker.labels.set(webProject, [{ id: toLabelId("lb-auto"), name: "factory" }]);
  const codeHost = new FakeCodeHost(toCodeHostKind("fake-host"));
  const trackerConfigs: unknown[] = [];
  const registry = new AdapterRegistry()
    .registerTracker({
      kind: tracker.kind,
      create: (config) => {
        trackerConfigs.push(config);
        return tracker;
      },
    })
    .registerCodeHost({ kind: codeHost.kind, create: () => codeHost });

  return {
    context: { db, secretBox: new SecretBox(new Uint8Array(32).fill(7)), registry },
    tracker,
    codeHost,
    trackerConfigs,
  };
}

async function addConnection(f: Fixture): Promise<TrackerConnectionId> {
  const saved = await saveTrackerConnectionSetting(
    f.context,
    { name: "Acme", apiKey: "lin_api_example", webhookSecret: "whsec_example" },
    now,
  );
  expect(saved).toEqual({ ok: true });
  const connection = listTrackerConnections(f.context.db, f.context.secretBox)[0];
  if (connection === undefined) throw new Error("no connection");
  return connection.id;
}

function addRunner(f: Fixture): RunnerId {
  const saved = saveRunnerSetting(
    f.context,
    {
      name: "runner-a",
      sshTarget: "factory@runner-a.example.com",
      orcaPath: "/usr/local/bin/orca",
      capacity: 3,
    },
    now,
  );
  if (!saved.ok) throw new Error(saved.reason);
  const id = listRunners(f.context.db)[0]?.id;
  if (id === undefined) throw new Error("no runner");
  return id;
}

const noopActions: SettingsActions = {
  saveGeneral: () => Promise.resolve({ ok: true }),
  addProject: () => Promise.resolve({ ok: true }),
  removeProject: () => Promise.resolve({ ok: true }),
  saveMapping: () => Promise.resolve({ ok: true }),
  saveInProgress: () => Promise.resolve({ ok: true }),
  saveLabel: () => Promise.resolve({ ok: true }),
  saveConnection: () => Promise.resolve({ ok: true }),
  checkConnection: () => Promise.resolve({ ok: true }),
  saveGitHubToken: () => Promise.resolve({ ok: true }),
  checkGitHubToken: () => Promise.resolve({ ok: true }),
  saveRunner: () => Promise.resolve({ ok: true }),
  recheckRunner: () => Promise.resolve({ ok: true }),
  saveAddresses: () => Promise.resolve({ ok: true }),
  pollRunnerChecks: () => Promise.resolve(false),
};

function render(page: SettingsPage, selected: SettingsItem): string {
  return renderWithMessages(
    <SettingsScreen page={page} selected={selected} onSelect={() => {}} actions={noopActions} />,
    settingsMessages,
  );
}

/** 편집 영역(aside) 안의 글 */
function panelText(html: string): string {
  const panel = html.split("<aside")[1] ?? "";
  return panel
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ");
}

describe("Settings 저장하고 다시 열기", () => {
  it("각 설정을 저장하고 다시 열면 같은 값이 보인다", async () => {
    const f = fixture();
    const connection = await addConnection(f);
    expect(await saveGitHubToken(f.context, { token: "github_pat_example" }, now)).toEqual({
      ok: true,
    });
    const runnerId = addRunner(f);
    recordRunnerCheck(f.context.db, {
      runnerId,
      online: true,
      checkedAt: now,
      error: null,
      projects: [{ id: repo, displayName: "acme/web", setupState: "ready" }],
      assignmentBlocked: false,
    });

    const ws = commerce;
    const project = { ws, connectionId: connection, projectId: webProject };
    expect(saveGeneral(f.context, { ws, name: "Acme Store", maxRunMinutes: 90 })).toEqual({
      ok: true,
    });
    expect(addTrackerProject(f.context, { ...project, name: "Web" })).toEqual({ ok: true });
    expect(
      saveMappingSetting(f.context, {
        ...project,
        runnerProjectId: repo,
        agentId: "codex",
        model: "gpt-example",
      }),
    ).toEqual({ ok: true });
    expect(saveInProgressState(f.context, { ...project, stateId: "st-doing" })).toEqual({
      ok: true,
    });
    expect(saveLabel(f.context, { ws, connectionId: connection, labelId: "lb-auto" })).toEqual({
      ok: true,
    });

    const page = await loadSettingsPage(f.context, ws);
    expect(page.workspace?.general).toEqual({ id: ws, name: "Acme Store", maxRunMinutes: 90 });
    expect(page.workspace?.trackerProjects).toEqual([
      {
        connection: { id: connection, name: "Acme" },
        error: null,
        projects: [
          { id: webProject, name: "Web", owner: { kind: "this" }, mappings: 1, queuedRuns: 0 },
          { id: labProject, name: "Lab", owner: { kind: "free" }, mappings: 0, queuedRuns: 0 },
        ],
      },
    ]);
    expect(page.workspace?.bound).toEqual([
      {
        connection: { id: connection, name: "Acme" },
        project: { id: webProject, name: "Web" },
        mapping: { runnerProject: repo, agent: "codex", model: "gpt-example" },
        inProgressStateId: "st-doing",
        states: {
          ok: true,
          items: [
            { id: "st-todo", name: "Todo" },
            { id: "st-doing", name: "In Progress" },
          ],
        },
      },
    ]);
    expect(page.workspace?.labels).toEqual([
      {
        connection: { id: connection, name: "Acme" },
        labelId: "lb-auto",
        labels: { ok: true, items: [{ id: "lb-auto", name: "factory" }] },
      },
    ]);
    expect(page.install.connections).toEqual([
      {
        id: connection,
        name: "Acme",
        hasWebhookSecret: true,
        webhookPath: `/api/webhooks/tracker/${connection}`,
      },
    ]);
    expect(page.install.githubToken).toBe(true);
    expect(page.install.runners).toEqual([
      {
        id: runnerId,
        name: "runner-a",
        sshTarget: "factory@runner-a.example.com",
        orcaPath: "/usr/local/bin/orca",
        capacity: 3,
        check: { status: "pending", requestedAt: now.toISOString() },
      },
    ]);
    expect(page.runnerProjects).toEqual([{ id: repo, name: "acme/web" }]);

    // 다시 연 화면이 저장한 값을 채워 보인다
    const general = render(page, "general");
    expect(general).toContain('value="Acme Store"');
    expect(general).toContain('value="90"');
    expect(panelText(render(page, "mapping"))).toContain("acme/web");
    expect(panelText(render(page, "mapping"))).toContain("Codex");
    expect(panelText(render(page, "progress"))).toContain("In Progress");
    expect(panelText(render(page, "label"))).toContain("factory");
    const runners = render(page, "runners");
    expect(runners).toContain('value="factory@runner-a.example.com"');
    expect(runners).toContain('value="/usr/local/bin/orca"');
    expect(runners).toContain('value="3"');
  });

  it("토큰은 암호화해 저장하고 화면 값에 담지 않는다", async () => {
    const f = fixture();
    await addConnection(f);
    await saveGitHubToken(f.context, { token: "github_pat_example" }, now);
    const raw = JSON.stringify([
      f.context.db.select().from(schema.trackerConnections).all(),
      f.context.db.select().from(schema.codeHostConnections).all(),
    ]);
    expect(raw).not.toContain("lin_api_example");
    expect(raw).not.toContain("whsec_example");
    expect(raw).not.toContain("github_pat_example");

    const page = JSON.stringify(await loadSettingsPage(f.context, commerce));
    expect(page).not.toContain("lin_api_example");
    expect(page).not.toContain("github_pat_example");
  });

  it("비밀값 칸을 비우고 저장하면 저장한 값을 그대로 쓴다", async () => {
    const f = fixture();
    const id = await addConnection(f);
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { id, name: "Acme HQ", apiKey: "", webhookSecret: "" },
        now,
      ),
    ).toEqual({ ok: true });
    expect(listTrackerConnections(f.context.db, f.context.secretBox)).toEqual([
      expect.objectContaining({
        id,
        name: "Acme HQ",
        secrets: { apiKey: "lin_api_example", webhookSecret: "whsec_example" },
      }),
    ]);
  });

  it("연결 확인에 실패하면 트래커 연결과 GitHub 토큰을 저장하지 않는다", async () => {
    const f = fixture();
    f.tracker.connection = { ok: false, error: { kind: "unauthorized" } };
    f.codeHost.connection = { ok: false, error: { kind: "unauthorized" } };
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { name: "Acme", apiKey: "wrong", webhookSecret: "" },
        now,
      ),
    ).toEqual({ ok: false, reason: "unauthorized" });
    expect(await saveGitHubToken(f.context, { token: "wrong" }, now)).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    const page = await loadSettingsPage(f.context, commerce);
    expect(page.install.connections).toEqual([]);
    expect(page.install.githubToken).toBe(false);
    // 확인할 때 어댑터는 입력한 키를 받았다
    expect(f.trackerConfigs).toEqual([
      { config: {}, secrets: { apiKey: "wrong", webhookSecret: null } },
    ]);
  });

  it("GitHub 토큰 안내에 필수 권한과 선택 권한을 보인다", async () => {
    const f = fixture();
    const text = panelText(render(await loadSettingsPage(f.context, commerce), "github"));
    expect(text).toContain("필수 권한: Metadata 읽기, Pull requests 읽기");
    expect(text).toContain("선택 권한: Actions 읽기");
  });

  it("Mapping 에서 권한을 미리 허용하라고 안내하고 러너는 고르지 않는다", async () => {
    const f = fixture();
    const connection = await addConnection(f);
    addTrackerProject(f.context, {
      ws: commerce,
      connectionId: connection,
      projectId: webProject,
      name: "Web",
    });
    const text = panelText(render(await loadSettingsPage(f.context, commerce), "mapping"));
    expect(text).toContain("에이전트 설정에서 미리 허용해 두세요");
    expect(text).toContain("러너 쪽 프로젝트");
    expect(text).not.toContain("러너 이름");
    // 모델은 선택 칸이고, 비우면 러너 설정이나 러너 Orca 의 기본값을 쓴다고 안내한다(0043)
    expect(text).toContain("모델");
    expect(text).toContain("러너 Orca의 기본값");
  });

  it("Mapping 의 모델은 비우면 정하지 않은 것으로 저장하고, 러너 CLI 옵션으로 읽힐 값은 받지 않는다(0043)", async () => {
    const f = fixture();
    const connectionId = await addConnection(f);
    const project = { ws: commerce, connectionId, projectId: webProject };
    addTrackerProject(f.context, { ...project, name: "Web" });
    const mapping = { ...project, runnerProjectId: repo, agentId: "claude" };
    const saved = async () => (await loadSettingsPage(f.context, commerce)).workspace?.bound[0];

    expect(saveMappingSetting(f.context, { ...mapping, model: "sonnet" })).toEqual({ ok: true });
    expect((await saved())?.mapping?.model).toBe("sonnet");
    // 지우고 저장하면 정하지 않은 것으로 돌아간다
    expect(saveMappingSetting(f.context, { ...mapping, model: "" })).toEqual({ ok: true });
    expect((await saved())?.mapping?.model).toBeNull();

    expect(mappingInput.safeParse({ ...mapping, model: " sonnet " }).data?.model).toBe("sonnet");
    expect(mappingInput.safeParse(mapping).success).toBe(true);
    for (const model of ["--dangerously-skip-permissions", "a b", "a\u0001", "x".repeat(201)]) {
      expect({ model, ok: mappingInput.safeParse({ ...mapping, model }).success }).toEqual({
        model,
        ok: false,
      });
    }
  });
});

describe("주소(0048)", () => {
  const local = { host: "127.0.0.1:3000", bindHost: "127.0.0.1" };

  it("두 주소를 origin 으로 저장하고 다시 열면 보인다. 비우면 정하지 않음이다", async () => {
    const f = fixture();
    expect((await loadSettingsPage(f.context, undefined)).install.addresses).toEqual({
      webAddress: null,
      webhookAddress: null,
    });
    expect(
      saveAddresses(
        f.context,
        {
          webAddress: "https://Server.example.ts.net/",
          webhookAddress: "https://hooks.example.com",
        },
        now,
        local,
      ),
    ).toEqual({ ok: true });
    const page = await loadSettingsPage(f.context, undefined);
    expect(page.install.addresses).toEqual({
      webAddress: "https://server.example.ts.net",
      webhookAddress: "https://hooks.example.com",
    });
    const shown = panelText(render(page, "addresses"));
    expect(shown).toContain("다른 기기에서 열 주소");
    expect(render(page, "addresses")).toContain('value="https://server.example.ts.net"');

    expect(saveAddresses(f.context, { webAddress: "", webhookAddress: "" }, now, local)).toEqual({
      ok: true,
    });
    expect((await loadSettingsPage(f.context, undefined)).install.addresses).toEqual({
      webAddress: null,
      webhookAddress: null,
    });
  });

  it("경로·사용자 정보가 붙거나 http·https 가 아닌 주소는 받지 않는다", () => {
    const f = fixture();
    for (const webAddress of [
      "server.example.ts.net",
      "https://server.example.ts.net/app",
      "ftp://x.example",
      "https://a:b@x.example",
    ]) {
      expect(saveAddresses(f.context, { webAddress, webhookAddress: "" }, now, local)).toEqual({
        ok: false,
        reason: "invalid-web-address",
      });
    }
    expect(
      saveAddresses(
        f.context,
        { webAddress: "", webhookAddress: "https://hooks.example.com/?x=1" },
        now,
        local,
      ),
    ).toEqual({ ok: false, reason: "invalid-webhook-address" });
  });

  it("저장하면 지금 보는 화면의 주소가 막히는 값은 저장하지 않는다", async () => {
    const f = fixture();
    const remote = { host: "server.example.ts.net", bindHost: "127.0.0.1" };
    expect(
      saveAddresses(
        f.context,
        { webAddress: "https://other.example.ts.net", webhookAddress: "" },
        now,
        remote,
      ),
    ).toEqual({ ok: false, reason: "locks-out" });
    expect((await loadSettingsPage(f.context, undefined)).install.addresses.webAddress).toBeNull();
    expect(
      saveAddresses(
        f.context,
        { webAddress: "https://server.example.ts.net", webhookAddress: "" },
        now,
        remote,
      ),
    ).toEqual({ ok: true });
    // 127.0.0.1 로 연 화면은 어떤 값을 넣어도 막히지 않는다
    expect(
      saveAddresses(
        f.context,
        { webAddress: "https://other.example.ts.net", webhookAddress: "" },
        now,
        local,
      ),
    ).toEqual({ ok: true });
  });
});

describe("트래커 프로젝트는 Workspace 하나에만", () => {
  it("이미 다른 Workspace 에 묶인 트래커 프로젝트는 고를 수 없다", async () => {
    const f = fixture();
    const connection = await addConnection(f);
    expect(
      addTrackerProject(f.context, {
        ws: commerce,
        connectionId: connection,
        projectId: webProject,
        name: "Web",
      }),
    ).toEqual({ ok: true });

    // 다른 Workspace 에서 넣으려 하면 거절한다
    expect(
      addTrackerProject(f.context, {
        ws: labs,
        connectionId: connection,
        projectId: webProject,
        name: "Web",
      }),
    ).toEqual({ ok: false, reason: "taken" });

    // 다른 Workspace 의 화면에는 묶인 Workspace 가 보이고 넣기 버튼이 꺼져 있다
    const page = await loadSettingsPage(f.context, labs);
    expect(page.workspace?.trackerProjects[0]?.projects).toEqual([
      {
        id: webProject,
        name: "Web",
        owner: { kind: "other", workspace: { id: commerce, name: "Acme Commerce" } },
        mappings: 0,
        queuedRuns: 0,
      },
      { id: labProject, name: "Lab", owner: { kind: "free" }, mappings: 0, queuedRuns: 0 },
    ]);
    const html = render(page, "projects");
    const webRow = html.split("<li").find((chunk) => chunk.includes(">Web<")) ?? "";
    expect(webRow).toContain("Acme Commerce에 있어요");
    expect(webRow).toMatch(/<button[^>]*disabled/);
    const labRow = html.split("<li").find((chunk) => chunk.includes(">Lab<")) ?? "";
    expect(labRow).not.toMatch(/<button[^>]*disabled/);

    // 다른 Workspace 에서는 뺄 수도 없다
    expect(
      removeTrackerProject(f.context, {
        ws: labs,
        connectionId: connection,
        projectId: webProject,
      }),
    ).toEqual({ ok: false, reason: "not-found" });
  });

  it("빼기 전에 함께 지워질 Mapping 과 그 Queued 런 수를 알고, 빼도 런 기록은 남는다", async () => {
    const f = fixture();
    const connection = await addConnection(f);
    const project = { ws: commerce, connectionId: connection, projectId: webProject };
    addTrackerProject(f.context, { ...project, name: "Web" });
    saveMappingSetting(f.context, { ...project, runnerProjectId: repo, agentId: "claude" });
    for (const key of ["ACME-1", "ACME-2"]) {
      const result = assignRun(f.context.db, {
        ticket: { connection, key: toTicketKey(key) },
        trackerProject: webProject,
        runnerProject: repo,
        agent: toAgentId("claude"),
        now,
      });
      expect(result.ok).toBe(true);
    }

    const before = await loadSettingsPage(f.context, commerce);
    expect(before.workspace?.trackerProjects[0]?.projects[0]).toMatchObject({
      id: webProject,
      mappings: 1,
      queuedRuns: 2,
    });

    expect(removeTrackerProject(f.context, project)).toEqual({ ok: true });
    const after = await loadSettingsPage(f.context, commerce);
    expect(after.workspace?.bound).toEqual([]);
    expect(after.workspace?.trackerProjects[0]?.projects[0]).toMatchObject({
      id: webProject,
      owner: { kind: "free" },
    });
    expect(f.context.db.select().from(schema.runs).all()).toHaveLength(2);
  });
});

describe("러너 확인", () => {
  const health = (overrides: Partial<RunnerHealth> = {}): RunnerHealth => ({
    online: true,
    version: "1.4.258",
    checkedAt: now,
    error: null,
    prerequisites: [
      {
        id: "orca-service",
        name: "Orca 상시 서비스",
        satisfied: true,
        hint: "orca serve service install",
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
    ...overrides,
  });

  async function checked(
    f: Fixture,
    runnerId: RunnerId,
    result: { result: RunnerHealth } | { error: string },
  ) {
    const pending = listPendingRunnerCheckRequests(f.context.db);
    const request = pending.find((p) => p.runnerId === runnerId);
    if (request === undefined) throw new Error("no pending request");
    expect(
      completeRunnerCheckRequest(f.context.db, {
        runnerId,
        requestedAt: request.requestedAt,
        completedAt: new Date(now.getTime() + 5000),
        ...result,
      }),
    ).toBe(true);
    return loadSettingsPage(f.context, commerce);
  }

  it("러너를 등록하면 확인 요청이 DB 에 생기고 기다리는 중으로 보인다", async () => {
    const f = fixture();
    const runnerId = addRunner(f);
    expect(listPendingRunnerCheckRequests(f.context.db)).toEqual([{ runnerId, requestedAt: now }]);
    expect(listRunners(f.context.db)[0]).toMatchObject({
      kind: "orca",
      config: { sshTarget: "factory@runner-a.example.com", orcaPath: "/usr/local/bin/orca" },
    });

    const later = new Date(now.getTime() + 60_000);
    expect(requestRunnerCheckSetting(f.context, { id: runnerId }, later)).toEqual({ ok: true });
    expect(listPendingRunnerCheckRequests(f.context.db)).toEqual([
      { runnerId, requestedAt: later },
    ]);
    const text = panelText(render(await loadSettingsPage(f.context, commerce), "runners"));
    expect(text).toContain("worker가 러너를 확인하고 있어요");
  });

  it("기다리는 동안 읽는 요청 상태는 결과가 오면 거짓이 되고 트래커를 부르지 않는다", async () => {
    const f = fixture();
    const runnerId = addRunner(f);
    expect(hasPendingRunnerChecks(f.context.db)).toBe(true);
    await checked(f, runnerId, { result: health() });
    expect(hasPendingRunnerChecks(f.context.db)).toBe(false);
    // 연결이 없으니 트래커 어댑터를 만든 적이 없다(가벼운 읽기는 DB 만 본다)
    expect(f.trackerConfigs).toEqual([]);
  });

  it("러너를 고쳐 저장해도 Settings 가 고치지 않는 설정 키는 남긴다", () => {
    const f = fixture();
    const runnerId = addRunner(f);
    saveRunner(f.context.db, {
      id: runnerId,
      kind: toRunnerKind("orca"),
      name: "runner-a",
      config: {
        sshTarget: "factory@runner-a.example.com",
        orcaPath: "/usr/local/bin/orca",
        extra: 1,
      },
      capacity: 3,
    });
    const saved = saveRunnerSetting(
      f.context,
      {
        id: runnerId,
        name: "runner-a",
        sshTarget: "factory@a.example.com",
        orcaPath: "/opt/orca",
        capacity: 2,
      },
      now,
    );
    expect(saved).toEqual({ ok: true, runnerId });
    expect(listRunners(f.context.db)[0]?.config).toEqual({
      sshTarget: "factory@a.example.com",
      orcaPath: "/opt/orca",
      extra: 1,
    });
  });

  it("ssh 옵션으로 읽힐 대상(- 로 시작)과 공백이 든 대상은 받지 않는다", () => {
    const base = { name: "runner-a", orcaPath: "/usr/local/bin/orca", capacity: 1 };
    expect(
      runnerInput.safeParse({ ...base, sshTarget: "factory@runner-a.example.com" }).success,
    ).toBe(true);
    expect(runnerInput.safeParse({ ...base, sshTarget: "-oProxyCommand=touch x" }).success).toBe(
      false,
    );
    expect(runnerInput.safeParse({ ...base, sshTarget: "host other" }).success).toBe(false);
    expect(runnerInput.safeParse({ ...base, sshTarget: "host\u0001" }).success).toBe(false);
  });

  it("결과를 넣으면 성공이 보이고 필수 조건을 하나씩 보인다", async () => {
    const f = fixture();
    const runnerId = addRunner(f);
    const page = await checked(f, runnerId, { result: health() });
    expect(page.install.runners[0]?.check).toMatchObject({
      status: "done",
      online: true,
      version: "1.4.258",
    });
    const text = panelText(render(page, "runners"));
    expect(text).toContain("러너에 닿았어요 · orca 1.4.258");
    expect(text).toContain("Orca 상시 서비스 갖췄어요");
    expect(text).toContain("acme/web GitHub 인증 갖췄어요");
    expect(text).not.toContain("해결 방법");
  });

  it("GitHub 인증이 깨진 결과는 실패와 해결 방법을 보인다", async () => {
    const f = fixture();
    const runnerId = addRunner(f);
    const page = await checked(f, runnerId, {
      result: health({
        prerequisites: [
          {
            id: "orca-service",
            name: "Orca 상시 서비스",
            satisfied: false,
            hint: "orca serve service install",
            blocksAssignment: false,
          },
          {
            id: "push:acme/web",
            name: "acme/web GitHub 인증",
            satisfied: false,
            hint: null,
            blocksAssignment: true,
          },
        ],
      }),
    });
    const text = panelText(render(page, "runners"));
    expect(text).toContain("Orca 상시 서비스 갖추지 못했어요");
    expect(text).toContain("orca serve service install");
    expect(text).toContain("acme/web GitHub 인증 갖추지 못했어요");
    expect(text).toContain("이 러너를 할당에서 뺐어요");
    expect(text).toContain("gh auth login --insecure-storage");
    expect(text).toContain("gh auth setup-git");
    expect(text).toContain("GitHub용 ssh 키");
  });

  it("runner-orca 의 확인 항목은 id 종류로 메시지를 골라 보이고 모르는 종류는 어댑터 이름을 보인다", async () => {
    const f = fixture();
    const runnerId = addRunner(f);
    recordRunnerCheck(f.context.db, {
      runnerId,
      online: true,
      checkedAt: now,
      error: null,
      projects: [{ id: repo, displayName: "acme/web", setupState: "ready" }],
      assignmentBlocked: true,
    });
    // 이름과 안내는 runner-orca 어댑터가 주는 영어 문자열 그대로다
    const page = await checked(f, runnerId, {
      result: health({
        prerequisites: [
          {
            id: "orca-service",
            name: "Orca background service",
            satisfied: false,
            hint: "/usr/local/bin/orca serve service install",
            blocksAssignment: false,
          },
          {
            id: `github-push:${repo}`,
            name: "GitHub push access: acme/web",
            satisfied: false,
            hint: "Run `gh auth login --insecure-storage` and `gh auth setup-git` on the runner.",
            blocksAssignment: true,
          },
          {
            id: "github-push:github:acme/gone",
            name: "GitHub push access: acme/gone",
            satisfied: true,
            hint: null,
            blocksAssignment: true,
          },
          {
            id: "disk-space",
            name: "Disk space",
            satisfied: true,
            hint: null,
            blocksAssignment: false,
          },
        ],
      }),
    });
    const text = panelText(render(page, "runners"));
    expect(text).toContain("Orca 상시 서비스 갖추지 못했어요");
    // 설치 명령은 언어가 없는 명령이라 그대로 보인다
    expect(text).toContain("/usr/local/bin/orca serve service install");
    // 러너 쪽 프로젝트 표시 이름을 넣고, 찾지 못하면 프로젝트 ID 를 넣는다
    expect(text).toContain("GitHub push 권한: acme/web 갖추지 못했어요");
    expect(text).toContain("GitHub push 권한: github:acme/gone 갖췄어요");
    expect(text).toContain("Disk space 갖췄어요");
    expect(text).not.toContain("Orca background service");
    expect(text).not.toContain("GitHub push access");
    expect(text).not.toContain("Run `gh auth login");
    expect(text).toContain("gh auth login --insecure-storage");
  });

  it("러너에 닿지 않은 결과와 확인 오류를 실패로 보인다", async () => {
    const f = fixture();
    const runnerId = addRunner(f);
    const offline = await checked(f, runnerId, {
      result: health({
        online: false,
        version: null,
        error: { kind: "unreachable", detail: "ssh: connect timed out" },
      }),
    });
    expect(panelText(render(offline, "runners"))).toContain(
      "러너에 닿지 않았어요 (ssh로 닿지 않음)",
    );

    requestRunnerCheckSetting(f.context, { id: runnerId }, new Date(now.getTime() + 10_000));
    const failed = await checked(f, runnerId, { error: "ssh failed" });
    expect(failed.install.runners[0]?.check).toMatchObject({
      status: "failed",
      error: "ssh failed",
    });
    expect(panelText(render(failed, "runners"))).toContain("러너를 확인하지 못했어요. ssh failed");
  });
});

describe("Settings 화면", () => {
  it("이 Workspace 와 설치 전체로 나눈다", async () => {
    const f = fixture();
    const html = render(await loadSettingsPage(f.context, commerce), "general");
    expect(html).toContain("이 Workspace");
    expect(html).toContain("설치 전체");
    expect(html).toContain("Acme Commerce Workspace");
    expect(html).toContain('aria-label="Workspace 설정"');
    expect(html).toContain('aria-label="설치 설정"');
  });

  it("전체 보기에서는 설치 전체만 고칠 수 있다", async () => {
    const f = fixture();
    const page = await loadSettingsPage(f.context, "all");
    expect(page.workspace).toBeNull();
    const html = render(page, "general");
    expect(html).toContain("Workspace를 고르면 그 Workspace의 설정을 바꿀 수 있어요.");
    expect(html).not.toContain('aria-label="Workspace 설정"');
    expect(panelText(html)).toContain("설치 전체");
  });
});

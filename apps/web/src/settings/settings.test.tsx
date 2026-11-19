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
} from "@ganger/core";
import type { RunnerHealth, RunnerId, TrackerConnectionId } from "@ganger/core";
import { FakeCodeHost, FakeTracker } from "@ganger/core/testing";
import {
  SecretBox,
  assignRun,
  completeRunnerCheckRequest,
  listPendingRunnerCheckRequests,
  listRunners,
  listTrackerConnections,
  migrate,
  openDatabase,
  recordMcpAction,
  recordRunnerCheck,
  saveRunner,
  saveWorkspace,
  schema,
  toWorkspaceId,
} from "@ganger/db";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serverMcpLaunch } from "../server/mcp-launch";
import { installPowerSettings } from "../server/power-settings";
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
  trackerConnectionInput,
  mappingInput,
  powerInput,
  saveMcpWriteSetting,
  savePowerSetting,
} from "@ganger/app/settings/actions";
import { hasPendingRunnerChecks, loadSettingsPage } from "@ganger/app/settings/load";
import type { SettingsContext } from "@ganger/app/settings/load";
import { settingsMessages } from "./messages";
import { INSTALL_ITEMS, WORKSPACE_ITEMS } from "@ganger/app/settings/model";
import type { SettingsItem, SettingsPage } from "@ganger/app/settings/model";
import { SettingsScreen } from "./settings-screen";
import type { SettingsActions } from "./settings-screen";

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
  savePower: () => Promise.resolve({ ok: true }),
  saveMcpWrite: () => Promise.resolve({ ok: true }),
  pollRunnerChecks: () => Promise.resolve(false),
};

function render(page: SettingsPage, selected: SettingsItem): string {
  return renderWithMessages(
    <SettingsScreen page={page} selected={selected} onSelect={() => {}} actions={noopActions} />,
    settingsMessages,
  );
}

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

    const page = await loadSettingsPage(f.context, ws, now);
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
        access: "manual",
        capacity: 3,
        check: { status: "pending", requestedAt: now.toISOString() },
      },
    ]);
    expect(page.runnerProjects).toEqual([{ id: repo, name: "acme/web" }]);

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

    const page = JSON.stringify(await loadSettingsPage(f.context, commerce, now));
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

  it("이름 없이 저장하면 연결 이름을 트래커 조직 이름으로, 조직 이름이 없으면 Linear로 정한다", async () => {
    const f = fixture();
    f.tracker.connection = { ok: true, organizationName: "Acme" };
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { apiKey: "lin_api_example", webhookSecret: "" },
        now,
      ),
    ).toEqual({ ok: true });
    f.tracker.connection = { ok: true, organizationName: null };
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { apiKey: "lin_api_other", webhookSecret: "" },
        now,
      ),
    ).toEqual({ ok: true });
    f.tracker.connection = { ok: true, organizationName: "   " };
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { apiKey: "lin_api_blank", webhookSecret: "" },
        now,
      ),
    ).toEqual({ ok: true });
    f.tracker.connection = { ok: true, organizationName: `  ${"가😀".repeat(150)}  ` };
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { apiKey: "lin_api_long", webhookSecret: "" },
        now,
      ),
    ).toEqual({ ok: true });
    const saved = listTrackerConnections(f.context.db, f.context.secretBox);
    expect(saved.map((c) => c.name).toSorted()).toEqual([
      "Acme",
      "Linear",
      "Linear",
      "가😀".repeat(100),
    ]);

    const long = saved.find((c) => c.name.startsWith("가"));
    if (long === undefined) throw new Error("no long connection");
    const resubmitted = trackerConnectionInput.parse({
      id: long.id,
      name: long.name,
      apiKey: "",
      webhookSecret: "",
    });
    expect(await saveTrackerConnectionSetting(f.context, resubmitted, now)).toEqual({ ok: true });
    expect(
      trackerConnectionInput.safeParse({
        name: `${long.name}가`,
        apiKey: "",
        webhookSecret: "",
      }).success,
    ).toBe(false);

    const id = saved.find((c) => c.name === "Acme")?.id ?? "";
    f.tracker.connection = { ok: true, organizationName: "Acme Renamed" };
    expect(
      await saveTrackerConnectionSetting(
        f.context,
        { id, apiKey: "lin_api_rotated", webhookSecret: "" },
        now,
      ),
    ).toEqual({ ok: true });
    expect(
      listTrackerConnections(f.context.db, f.context.secretBox).find((c) => c.id === id)?.name,
    ).toBe("Acme");
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
    const page = await loadSettingsPage(f.context, commerce, now);
    expect(page.install.connections).toEqual([]);
    expect(page.install.githubToken).toBe(false);
    expect(f.trackerConfigs).toEqual([
      { config: {}, secrets: { apiKey: "wrong", webhookSecret: null } },
    ]);
  });

  it("GitHub 토큰 안내에 필수 권한과 선택 권한을 보인다", async () => {
    const f = fixture();
    const text = panelText(render(await loadSettingsPage(f.context, commerce, now), "github"));
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
    const text = panelText(render(await loadSettingsPage(f.context, commerce, now), "mapping"));
    expect(text).toContain("에이전트 설정에서 미리 허용해 두세요");
    expect(text).toContain("러너 쪽 프로젝트");
    expect(text).not.toContain("러너 이름");
    expect(text).toContain("모델");
    expect(text).toContain("러너 Orca의 기본값");
  });

  it("Mapping 의 모델은 비우면 정하지 않은 것으로 저장하고, 러너 CLI 옵션으로 읽힐 값은 받지 않는다(0043)", async () => {
    const f = fixture();
    const connectionId = await addConnection(f);
    const project = { ws: commerce, connectionId, projectId: webProject };
    addTrackerProject(f.context, { ...project, name: "Web" });
    const mapping = { ...project, runnerProjectId: repo, agentId: "claude" };
    const saved = async () =>
      (await loadSettingsPage(f.context, commerce, now)).workspace?.bound[0];

    expect(saveMappingSetting(f.context, { ...mapping, model: "sonnet" })).toEqual({ ok: true });
    expect((await saved())?.mapping?.model).toBe("sonnet");
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
    expect((await loadSettingsPage(f.context, undefined, now)).install.addresses).toEqual({
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
    const page = await loadSettingsPage(f.context, undefined, now);
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
    expect((await loadSettingsPage(f.context, undefined, now)).install.addresses).toEqual({
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
      "https://my_host.example",
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
    expect(
      (await loadSettingsPage(f.context, undefined, now)).install.addresses.webAddress,
    ).toBeNull();
    expect(
      saveAddresses(
        f.context,
        { webAddress: "https://server.example.ts.net", webhookAddress: "" },
        now,
        remote,
      ),
    ).toEqual({ ok: true });
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

    expect(
      addTrackerProject(f.context, {
        ws: labs,
        connectionId: connection,
        projectId: webProject,
        name: "Web",
      }),
    ).toEqual({ ok: false, reason: "taken" });

    const page = await loadSettingsPage(f.context, labs, now);
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

    const before = await loadSettingsPage(f.context, commerce, now);
    expect(before.workspace?.trackerProjects[0]?.projects[0]).toMatchObject({
      id: webProject,
      mappings: 1,
      queuedRuns: 2,
    });
    expect(render(before, "projects")).toMatch(
      /<button[^>]*data-variant="danger"[^>]*>빼기<\/button>/,
    );

    expect(removeTrackerProject(f.context, project)).toEqual({ ok: true });
    const after = await loadSettingsPage(f.context, commerce, now);
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
    return loadSettingsPage(f.context, commerce, now);
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
    const text = panelText(render(await loadSettingsPage(f.context, commerce, now), "runners"));
    expect(text).toContain("worker가 러너를 확인하고 있어요");
    expect(text).toContain("확인하는 중");
    expect(text).not.toContain("다시 확인");
  });

  it("기다리는 동안 읽는 요청 상태는 결과가 오면 거짓이 되고 트래커를 부르지 않는다", async () => {
    const f = fixture();
    const runnerId = addRunner(f);
    expect(hasPendingRunnerChecks(f.context.db)).toBe(true);
    await checked(f, runnerId, { result: health() });
    expect(hasPendingRunnerChecks(f.context.db)).toBe(false);
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

  it("확인 시각은 서버가 읽은 때부터의 상대 시간이다(ADR 0010 7번)", async () => {
    const f = fixture();
    const runnerId = addRunner(f);
    await checked(f, runnerId, { result: health() });
    const later = await loadSettingsPage(
      f.context,
      commerce,
      new Date(now.getTime() + 25 * 60_000),
    );
    const check = later.install.runners[0]?.check;
    expect(check).toMatchObject({ status: "done", completedAgoMs: 25 * 60_000 - 5000 });
    expect(panelText(render(later, "runners"))).toContain("24분 전 확인");
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
    expect(text).toContain("/usr/local/bin/orca serve service install");
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
  it("어느 항목을 열어도 노란 주 버튼은 하나 이하다(ADR 0010 6번)", async () => {
    const f = fixture();
    const connection = await addConnection(f);
    const project = { ws: commerce, connectionId: connection, projectId: webProject };
    addTrackerProject(f.context, { ...project, name: "Web" });
    saveMappingSetting(f.context, { ...project, runnerProjectId: repo, agentId: "claude" });
    addRunner(f);
    const page = await loadSettingsPage(f.context, commerce, now);
    for (const item of [...WORKSPACE_ITEMS, ...INSTALL_ITEMS]) {
      const primary = [...render(page, item).matchAll(/data-variant="primary"/g)].length;
      expect({ item, primary: primary <= 1 }).toEqual({ item, primary: true });
    }
  });

  it("비밀값 칸은 새 비밀번호를 권하지 않고 비밀번호 관리자가 건너뛴다(0055)", async () => {
    const f = fixture();
    await addConnection(f);
    const page = await loadSettingsPage(f.context, commerce, now);
    const secrets = [
      ...render(page, "connections").matchAll(/<input[^>]*>/g),
      ...render(page, "github").matchAll(/<input[^>]*>/g),
    ]
      .map((match) => match[0])
      .filter((input) => input.includes('type="password"'));
    expect(secrets.length).toBe(5);
    for (const input of secrets) {
      expect(input).not.toContain("new-password");
      expect(input).toContain('autoComplete="off"');
      expect(input).toContain('data-1p-ignore="true"');
      expect(input).toContain('data-lpignore="true"');
    }
  });

  it("분·Capacity 칸은 숫자 키보드를 쓰고, 처음 열 때는 오류를 보이지 않는다(0055)", async () => {
    const f = fixture();
    const page = await loadSettingsPage(f.context, commerce, now);
    const general = render(page, "general");
    expect(/<input[^>]*name="maxRunMinutes"[^>]*>/.exec(general)?.[0]).toContain(
      'inputMode="numeric"',
    );
    const runners = render(page, "runners");
    expect(/<input[^>]*name="capacity"[^>]*>/.exec(runners)?.[0]).toContain('inputMode="numeric"');
    expect(general).not.toContain('aria-invalid="true"');
    expect(runners).not.toContain('aria-invalid="true"');
  });

  it("이 Workspace 와 설치 전체로 나눈다", async () => {
    const f = fixture();
    const html = render(await loadSettingsPage(f.context, commerce, now), "general");
    expect(html).toContain("이 Workspace");
    expect(html).toContain("설치 전체");
    expect(html).toContain("Acme Commerce Workspace");
    expect(html).toContain('aria-label="Workspace 설정"');
    expect(html).toContain('aria-label="설치 설정"');
  });

  it("전체 보기에서는 설치 전체만 고칠 수 있다", async () => {
    const f = fixture();
    const page = await loadSettingsPage(f.context, "all", now);
    expect(page.workspace).toBeNull();
    const html = render(page, "general");
    expect(html).toContain("Workspace를 고르면 그 Workspace의 설정을 바꿀 수 있어요.");
    expect(html).not.toContain('aria-label="Workspace 설정"');
    expect(panelText(html)).toContain("설치 전체");
  });
});

describe("잠자기 방지(0084)", () => {
  function withHome<T>(use: (home: string) => T): T {
    const home = mkdtempSync(join(tmpdir(), "ganger-web-power-"));
    try {
      return use(home);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  it("설치 폴더를 모르면 바꿀 수 없다고 보이고 저장하지 않는다", async () => {
    const f = fixture();
    const page = await loadSettingsPage(f.context, undefined, now);
    expect(page.install.power).toEqual({ available: false, preventSleep: true });
    const shown = panelText(render(page, "power"));
    expect(shown).toContain("ganger start로 띄우지 않아 여기서 바꿀 수 없어요");
    expect(render(page, "power")).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    expect(savePowerSetting(f.context, { preventSleep: false })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("기본은 켜짐이고, 끄면 설치 폴더의 power.json에 저장해 다시 열면 꺼져 있다", async () => {
    await withHome(async (home) => {
      const power = installPowerSettings({ GANGER_HOME: home });
      if (power === undefined) throw new Error("home not accepted");
      const f = fixture();
      const context = { ...f.context, power };
      expect((await loadSettingsPage(context, undefined, now)).install.power).toEqual({
        available: true,
        preventSleep: true,
      });
      expect(savePowerSetting(context, { preventSleep: false })).toEqual({ ok: true });
      expect(JSON.parse(readFileSync(join(home, "power.json"), "utf8"))).toEqual({
        preventSleep: false,
      });
      const page = await loadSettingsPage(context, undefined, now);
      expect(page.install.power).toEqual({ available: true, preventSleep: false });
      const shown = panelText(render(page, "power"));
      expect(shown).toContain("서버가 도는 동안 이 맥이 잠들지 않게");
      expect(shown).toContain("뚜껑을 닫거나");
      expect(shown).toContain("러너 맥");
    });
  });

  it("설치 폴더 값은 절대 경로일 때만 받는다", () => {
    expect(installPowerSettings({})).toBeUndefined();
    expect(installPowerSettings({ GANGER_HOME: " " })).toBeUndefined();
    expect(installPowerSettings({ GANGER_HOME: "relative/home" })).toBeUndefined();
  });

  it("켜기·끄기 값은 boolean만 받는다", () => {
    expect(powerInput.safeParse({ preventSleep: true }).success).toBe(true);
    expect(powerInput.safeParse({ preventSleep: "false" }).success).toBe(false);
  });
});

describe("MCP 구역(0088)", () => {
  const appEnv = {
    GANGER_CLI_ENTRY: "/Applications/Ganger.app/Contents/Resources/server/cli/bin/cli.js",
    GANGER_HOME: "/Users/operator/.ganger",
    ELECTRON_RUN_AS_NODE: "1",
  };
  const appNode = "/Applications/Ganger.app/Contents/MacOS/Ganger";

  it("앱 안 CLI의 절대 경로가 든 Hermes·JSON 설정 조각과 복사 버튼을 보인다", async () => {
    const f = fixture();
    const context = { ...f.context, mcpLaunch: serverMcpLaunch(appEnv, appNode) };
    const page = await loadSettingsPage(context, commerce, now);
    const html = render(page, "mcp");
    const shown = panelText(html);
    expect(shown).toContain("mcp_servers:");
    expect(shown).toContain(`command: "${appNode}"`);
    expect(shown).toContain(`- "${appEnv.GANGER_CLI_ENTRY}"`);
    expect(shown).toContain('ELECTRON_RUN_AS_NODE: "1"');
    expect(shown).toContain('"mcpServers"');
    expect(shown).toContain("~/.hermes/config.yaml");
    expect(shown).toContain("external 칸");
    expect(shown).not.toContain("CLI 위치를 몰라요");
    expect(html).toContain("Hermes 설정 복사");
    expect(html).toContain("다른 클라이언트(JSON) 설정 복사");
  });

  it("CLI 위치를 모르면 PATH의 ganger를 쓰라고 알린다", async () => {
    const f = fixture();
    const context = { ...f.context, mcpLaunch: serverMcpLaunch({}, "/usr/bin/node") };
    const shown = panelText(render(await loadSettingsPage(context, commerce, now), "mcp"));
    expect(shown).toContain("CLI 위치를 몰라요");
    expect(shown).toContain('command: "ganger"');
  });

  it("CLI·설치 폴더 경로는 절대 경로일 때만 받는다", () => {
    expect(
      serverMcpLaunch({ GANGER_CLI_ENTRY: "cli.js", GANGER_HOME: "home" }, "/usr/bin/node"),
    ).toEqual({ located: false, command: "ganger", args: ["mcp"], env: {} });
  });
});

describe("MCP 쓰기 허용과 최근 작업(0089)", () => {
  it("스위치는 처음엔 꺼져 있고, 저장하면 켜진 채로 다시 보인다", async () => {
    const f = fixture();
    const off = await loadSettingsPage(f.context, commerce, now);
    expect(off.install.mcp.writeAllowed).toBe(false);
    expect(render(off, "mcp")).toContain("읽기만 열려 있어요");
    expect(panelText(render(off, "mcp"))).toContain("MCP 쓰기 허용");
    expect(panelText(render(off, "mcp"))).toContain("이 화면에서만 바꿀 수 있어요");

    expect(saveMcpWriteSetting(f.context, { allowed: true }, now)).toEqual({ ok: true });
    const on = await loadSettingsPage(f.context, commerce, now);
    expect(on.install.mcp.writeAllowed).toBe(true);
    expect(render(on, "mcp")).toContain("쓰기도 열려 있어요");
    expect(render(on, "mcp")).toMatch(
      /name="mcpWriteAllowed"[^>]*checked|checked[^>]*name="mcpWriteAllowed"/,
    );
  });

  it("런과 상관없는 MCP 쓰기는 최근 작업에 MCP · 이름, 도구, 대상, 결과로 보이고 Operator라고 보내도 MCP가 붙는다", async () => {
    const f = fixture();
    expect(panelText(render(await loadSettingsPage(f.context, commerce, now), "mcp"))).toContain(
      "아직 MCP 클라이언트가 한 작업이 없어요",
    );
    recordMcpAction(f.context.db, {
      at: new Date(now.getTime() - 60_000),
      client: "Operator",
      tool: "set_runner_capacity",
      target: "runner-a",
      runId: null,
      outcome: "done",
      reason: null,
    });
    recordMcpAction(f.context.db, {
      at: now,
      client: "hermes\u0007\u202e",
      tool: "request_runner_check",
      target: "runner-b",
      runId: null,
      outcome: "rejected",
      reason: "not-found",
    });

    const shown = panelText(render(await loadSettingsPage(f.context, commerce, now), "mcp"));
    expect(shown).toContain("MCP · Operator");
    expect(shown).toContain("러너 Capacity 바꾸기 · runner-a");
    expect(shown).toContain("MCP · hermes");
    expect(shown).not.toContain("\u202e");
    expect(shown).toContain("러너 다시 확인 · runner-b 하지 못했어요: 대상을 찾지 못했어요");
    expect(shown.indexOf("MCP · hermes")).toBeLessThan(shown.indexOf("MCP · Operator"));
  });
});

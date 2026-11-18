import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  DetailPanel,
  Dialog,
  DialogClose,
  Field,
  Input,
  PageHeader,
  PanelBlock,
  PanelHeader,
  RowTitle,
  Section,
  Select,
  SplitView,
  StatusPill,
  Table,
  TableCell,
  TableRow,
  TableRows,
  Text,
  showToast,
} from "@factory/ui";
import { colors, space } from "@factory/ui/tokens.stylex";
import { useEffect, useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { prerequisiteHint, useAgentName, usePrerequisiteName } from "../labels";
import { useStatusName } from "../status";
import {
  INSTALL_ITEMS,
  MAX_RUN_MINUTES,
  RUNNER_CHECK_POLL_LIMIT_MS,
  RUNNER_CHECK_POLL_MS,
  WORKSPACE_ITEMS,
} from "./model";
import type {
  AddressesView,
  BoundProject,
  Choice,
  ConnectionLabel,
  ConnectionProjects,
  PrerequisiteView,
  RunnerCheckView,
  RunnerSettingsView,
  SettingsItem,
  SettingsPage,
  TrackerConnectionView,
  TrackerProjectChoice,
  WorkspaceSettings,
} from "./model";

/** 저장 결과. 실패 까닭은 settings.remoteError 의 키이거나 그 밖의 값이다 */
export type ActionResult = { ok: true } | { ok: false; reason: string };

interface ProjectRef {
  ws: string;
  connectionId: string;
  projectId: string;
}

/** 화면의 저장·확인 행동. 라우트가 server function 으로 잇고, 성공하면 화면 값을 다시 읽는다 */
export interface SettingsActions {
  saveGeneral: (input: {
    ws: string;
    name: string;
    maxRunMinutes: number;
  }) => Promise<ActionResult>;
  addProject: (input: ProjectRef & { name: string }) => Promise<ActionResult>;
  removeProject: (input: ProjectRef) => Promise<ActionResult>;
  saveMapping: (
    input: ProjectRef & { runnerProjectId: string; agentId: string; model: string },
  ) => Promise<ActionResult>;
  saveInProgress: (input: ProjectRef & { stateId: string }) => Promise<ActionResult>;
  saveLabel: (input: {
    ws: string;
    connectionId: string;
    labelId: string;
  }) => Promise<ActionResult>;
  saveConnection: (input: {
    id?: string;
    name: string;
    apiKey: string;
    webhookSecret: string;
  }) => Promise<ActionResult>;
  checkConnection: (input: { id: string }) => Promise<ActionResult>;
  saveGitHubToken: (input: { token: string }) => Promise<ActionResult>;
  checkGitHubToken: () => Promise<ActionResult>;
  saveRunner: (input: {
    id?: string;
    name: string;
    sshTarget: string;
    orcaPath: string;
    capacity: number;
  }) => Promise<ActionResult>;
  recheckRunner: (input: { id: string }) => Promise<ActionResult>;
  /** 다른 기기에서 열 주소와 webhook 공개 주소(0048). 빈 값은 정하지 않음이다 */
  saveAddresses: (input: { webAddress: string; webhookAddress: string }) => Promise<ActionResult>;
  /**
   * 러너 확인 결과를 기다리는 동안 부른다. 아직 기다리면 true 다. 결과가 오면 화면 값을 다시 읽는다.
   * 트래커를 부르지 않는 가벼운 읽기여야 한다.
   */
  pollRunnerChecks: () => Promise<boolean>;
}

export interface SettingsScreenProps {
  page: SettingsPage;
  /** 고른 항목. 없거나 고를 수 없으면 Workspace 가 있으면 일반, 없으면 트래커 연결 */
  selected: string | undefined;
  onSelect: (item: SettingsItem) => void;
  actions: SettingsActions;
}

/** Settings: 왼쪽 항목 목록 + 오른쪽 편집 영역(ADR 0007, 시안 B). 이 Workspace / 설치 전체로 나눈다(ADR 0006) */
export function SettingsScreen({ page, selected, onSelect, actions }: SettingsScreenProps) {
  const t = useTranslations("settings");
  const workspace = page.workspace;
  const items: ReadonlyArray<SettingsItem> =
    workspace === null ? INSTALL_ITEMS : [...WORKSPACE_ITEMS, ...INSTALL_ITEMS];
  const current: SettingsItem =
    items.find((item) => item === selected) ?? (workspace === null ? "connections" : "general");

  const pendingKey = page.install.runners
    .flatMap((r) => (r.check?.status === "pending" ? [`${r.id}@${r.check.requestedAt}`] : []))
    .join(",");
  const workerSilent = useRunnerCheckPolling(pendingKey, actions.pollRunnerChecks);

  return (
    <SplitView
      variant="editor"
      list={
        <>
          <PageHeader title={t("title")} />
          <Section
            title={t("workspaceGroup")}
            {...(workspace === null ? {} : { note: workspace.general.name })}
          >
            {workspace === null ? (
              <Text variant="meta">{t("noWorkspace")}</Text>
            ) : (
              <ItemList
                label={t("workspaceListLabel")}
                items={WORKSPACE_ITEMS}
                selected={current}
                onSelect={onSelect}
                summary={(item) => <WorkspaceSummary item={item} workspace={workspace} />}
              />
            )}
          </Section>
          <Section title={t("installGroup")} note={t("installNote")}>
            <ItemList
              label={t("installListLabel")}
              items={INSTALL_ITEMS}
              selected={current}
              onSelect={onSelect}
              summary={(item) => <InstallSummary item={item} page={page} />}
            />
          </Section>
        </>
      }
      panel={
        <section aria-label={t("panelLabel")}>
          <DetailPanel>
            <PanelHeader
              status={
                <Text variant="meta">
                  {workspace !== null && isWorkspaceItem(current)
                    ? t("scopeWorkspace", { name: workspace.general.name })
                    : t("scopeInstall")}
                </Text>
              }
              title={t(`items.${current}`)}
            />
            {/* Workspace 나 항목을 바꾸면 편집 중인 값을 새로 채운다 */}
            <ItemPanel
              key={`${workspace?.general.id ?? ""}:${current}`}
              item={current}
              page={page}
              actions={actions}
              workerSilent={workerSilent}
            />
          </DetailPanel>
        </section>
      }
    />
  );
}

/**
 * 러너 확인 결과를 기다리는 동안 요청 상태만 다시 읽는다. `pendingKey` 는 기다리는 요청들(러너와 요청 시각)이라
 * 새 요청이 생기면 처음부터 다시 기다린다. 앞 읽기가 끝난 뒤에만 다음 읽기를 걸어 겹치지 않는다.
 * RUNNER_CHECK_POLL_LIMIT_MS 가 지나도 결과가 없으면 그만 읽고 true(worker 가 응답하지 않음)를 돌려준다.
 */
export function useRunnerCheckPolling(pendingKey: string, poll: () => Promise<boolean>): boolean {
  const [silent, setSilent] = useState(false);
  useEffect(() => {
    setSilent(false);
    if (pendingKey === "") return undefined;
    const started = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => {
      timer = setTimeout(() => {
        if (stopped) return;
        if (Date.now() - started > RUNNER_CHECK_POLL_LIMIT_MS) {
          setSilent(true);
          return;
        }
        poll().then(
          (still) => {
            if (still && !stopped) next();
          },
          () => {
            if (!stopped) next();
          },
        );
      }, RUNNER_CHECK_POLL_MS);
    };
    next();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [pendingKey, poll]);
  return silent;
}

function isWorkspaceItem(item: SettingsItem): boolean {
  return WORKSPACE_ITEMS.some((i) => i === item);
}

function ItemList({
  label,
  items,
  selected,
  onSelect,
  summary,
}: {
  label: string;
  items: ReadonlyArray<SettingsItem>;
  selected: SettingsItem;
  onSelect: (item: SettingsItem) => void;
  summary: (item: SettingsItem) => ReactNode;
}) {
  const t = useTranslations("settings");
  return (
    <Table columns="minmax(0, 1fr)">
      <TableRows
        label={label}
        value={items.some((i) => i === selected) ? selected : null}
        onValueChange={(value) => {
          const item = items.find((i) => i === value);
          if (item !== undefined) onSelect(item);
        }}
      >
        {items.map((item) => (
          <TableRow key={item} value={item} label={t(`items.${item}`)}>
            <TableCell>
              <span {...stylex.props(styles.titleCell)}>
                <RowTitle>{t(`items.${item}`)}</RowTitle>
                <Text variant="meta" truncate>
                  {summary(item)}
                </Text>
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableRows>
    </Table>
  );
}

function WorkspaceSummary({
  item,
  workspace,
}: {
  item: SettingsItem;
  workspace: WorkspaceSettings;
}) {
  const t = useTranslations("settings.summary");
  const total = workspace.bound.length;
  switch (item) {
    case "general":
      return t("general", { minutes: workspace.general.maxRunMinutes });
    case "projects":
      return t("projects", { count: total });
    case "mapping":
      return t("mapping", {
        mapped: workspace.bound.filter((b) => b.mapping !== null).length,
        total,
      });
    case "progress":
      return t("progress", {
        set: workspace.bound.filter((b) => b.inProgressStateId !== null).length,
        total,
      });
    case "label":
      return t("label", {
        set: workspace.labels.filter((l) => l.labelId !== null).length,
        total: workspace.labels.length,
      });
    case "connections":
    case "github":
    case "runners":
    case "addresses":
      return null;
  }
}

function InstallSummary({ item, page }: { item: SettingsItem; page: SettingsPage }) {
  const t = useTranslations("settings.summary");
  switch (item) {
    case "connections":
      return t("connections", { count: page.install.connections.length });
    case "github":
      return page.install.githubToken ? t("githubSet") : t("githubUnset");
    case "runners":
      return t("runners", { count: page.install.runners.length });
    case "addresses": {
      const { webAddress, webhookAddress } = page.install.addresses;
      return t("addresses", {
        set: [webAddress, webhookAddress].filter((a) => a !== null).length,
      });
    }
    case "general":
    case "projects":
    case "mapping":
    case "progress":
    case "label":
      return null;
  }
}

function ItemPanel({
  item,
  page,
  actions,
  workerSilent,
}: {
  item: SettingsItem;
  page: SettingsPage;
  actions: SettingsActions;
  workerSilent: boolean;
}) {
  const workspace = page.workspace;
  switch (item) {
    case "connections":
      return <ConnectionsPanel connections={page.install.connections} actions={actions} />;
    case "github":
      return <GitHubPanel saved={page.install.githubToken} actions={actions} />;
    case "runners":
      return (
        <RunnersPanel
          runners={page.install.runners}
          actions={actions}
          workerSilent={workerSilent}
          workspaceId={workspace?.general.id ?? null}
        />
      );
    case "addresses":
      return <AddressesPanel addresses={page.install.addresses} actions={actions} />;
    case "general":
    case "projects":
    case "mapping":
    case "progress":
    case "label":
      if (workspace === null) return null;
      switch (item) {
        case "general":
          return <GeneralPanel workspace={workspace} actions={actions} />;
        case "projects":
          return <ProjectsPanel workspace={workspace} actions={actions} />;
        case "mapping":
          return <MappingPanel workspace={workspace} page={page} actions={actions} />;
        case "progress":
          return <ProgressPanel workspace={workspace} actions={actions} />;
        case "label":
          return <LabelPanel workspace={workspace} actions={actions} />;
      }
  }
}

// ---------- 저장 상태 ----------

type SubmitState = { kind: "idle" } | { kind: "sending" } | { kind: "failed"; reason: string };

/** 저장·확인 하나의 상태. 성공하면 토스트로 알리고, 실패는 화면 안에 남긴다(DESIGN.md Toaster) */
function useSubmit() {
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const run = (action: () => Promise<ActionResult>, success: string, onSuccess?: () => void) => {
    if (state.kind === "sending") return;
    setState({ kind: "sending" });
    action().then(
      (result) => {
        if (result.ok) {
          setState({ kind: "idle" });
          showToast(success);
          onSuccess?.();
        } else {
          setState({ kind: "failed", reason: result.reason });
        }
      },
      () => setState({ kind: "failed", reason: "unknown" }),
    );
  };
  return { state, run, sending: state.kind === "sending" };
}

/** 실패 까닭을 문구로 바꾼다. 모르는 까닭은 일반 실패 문구다 */
function useReason(): (reason: string) => string {
  const t = useTranslations("settings");
  return (reason) => {
    switch (reason) {
      case "unauthorized":
      case "rate-limited":
      case "not-found":
      case "network":
      case "invalid":
      case "missing-key":
      case "taken":
        return t(`remoteError.${reason}`);
      case "invalid-web-address":
      case "invalid-webhook-address":
      case "locks-out":
        return t(`addresses.error.${reason}`);
      default:
        return t("failed");
    }
  };
}

function SubmitError({ state }: { state: SubmitState }) {
  const reason = useReason();
  if (state.kind !== "failed") return null;
  return (
    <p role="alert" {...stylex.props(styles.error)}>
      {reason(state.reason)}
    </p>
  );
}

// ---------- 이 Workspace ----------

function GeneralPanel({
  workspace,
  actions,
}: {
  workspace: WorkspaceSettings;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const { general } = workspace;
  const [name, setName] = useState(general.name);
  const [maxRun, setMaxRun] = useState(String(general.maxRunMinutes));
  const submit = useSubmit();
  const minutes = parseWholeNumber(maxRun);
  const nameOk = name.trim() !== "";
  const maxRunOk = minutes !== null && minutes >= 1 && minutes <= MAX_RUN_MINUTES;
  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!nameOk || minutes === null || !maxRunOk) return;
        submit.run(
          () => actions.saveGeneral({ ws: general.id, name: name.trim(), maxRunMinutes: minutes }),
          t("saved"),
        );
      }}
    >
      <Field label={t("general.name")} error={nameOk ? undefined : t("general.nameInvalid")}>
        <Input name="name" value={name} onValueChange={setName} autoComplete="off" />
      </Field>
      <Field
        label={t("general.maxRun")}
        description={t("general.maxRunDescription")}
        error={maxRunOk ? undefined : t("general.maxRunInvalid")}
      >
        <Input
          name="maxRunMinutes"
          value={maxRun}
          onValueChange={setMaxRun}
          autoComplete="off"
          mono
        />
      </Field>
      <SubmitError state={submit.state} />
      <Actions>
        <Button variant="primary" type="submit" disabled={submit.sending || !nameOk || !maxRunOk}>
          {submit.sending ? t("saving") : t("save")}
        </Button>
      </Actions>
    </form>
  );
}

export function ProjectsPanel({
  workspace,
  actions,
}: {
  workspace: WorkspaceSettings;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const reason = useReason();
  return (
    <>
      <Text variant="body">{t("projects.hint")}</Text>
      {workspace.trackerProjects.length === 0 ? (
        <Text variant="meta">{t("projects.noConnections")}</Text>
      ) : (
        workspace.trackerProjects.map((group) => (
          <PanelBlock key={group.connection.id} title={group.connection.name}>
            {group.error === null ? null : (
              <p {...stylex.props(styles.error)}>
                {t("projects.listFailed", { reason: reason(group.error) })}
              </p>
            )}
            <ProjectRows ws={workspace.general.id} group={group} actions={actions} />
          </PanelBlock>
        ))
      )}
    </>
  );
}

function ProjectRows({
  ws,
  group,
  actions,
}: {
  ws: string;
  group: ConnectionProjects;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings.projects");
  if (group.projects.length === 0) {
    return group.error === null ? <Text variant="meta">{t("empty")}</Text> : null;
  }
  return (
    <ul {...stylex.props(styles.list)}>
      {group.projects.map((project) => (
        <ProjectRow
          key={project.id}
          project={project}
          refInput={{ ws, connectionId: group.connection.id, projectId: project.id }}
          actions={actions}
        />
      ))}
    </ul>
  );
}

function ProjectRow({
  project,
  refInput,
  actions,
}: {
  project: TrackerProjectChoice;
  refInput: ProjectRef;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings.projects");
  const submit = useSubmit();
  const owner = project.owner;
  return (
    <li {...stylex.props(styles.item)}>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.rowText)}>
          <span
            {...stylex.props(owner.kind === "other" ? styles.disabledText : styles.primaryText)}
          >
            {project.name}
          </span>
          {owner.kind === "free" ? null : (
            <Text variant="meta">
              {owner.kind === "this"
                ? t("inThis")
                : t("inOther", { workspace: owner.workspace.name })}
            </Text>
          )}
        </span>
        {owner.kind === "this" ? (
          <Dialog
            trigger={t("remove")}
            triggerVariant="ghost"
            title={t("removeTitle", { project: project.name })}
            description={
              <>
                {t("removeBody", { mappings: project.mappings })}
                {project.queuedRuns === 0 ? null : (
                  <> {t("removeQueued", { count: project.queuedRuns })}</>
                )}
              </>
            }
            actions={
              <>
                <DialogClose>{t("cancel")}</DialogClose>
                <DialogClose
                  variant="primary"
                  onClick={() =>
                    submit.run(
                      () => actions.removeProject(refInput),
                      t("removed", { project: project.name }),
                    )
                  }
                >
                  {t("remove")}
                </DialogClose>
              </>
            }
          />
        ) : (
          <Button
            disabled={owner.kind === "other" || submit.sending}
            onClick={() =>
              submit.run(
                () => actions.addProject({ ...refInput, name: project.name }),
                t("added", { project: project.name }),
              )
            }
          >
            {t("add")}
          </Button>
        )}
      </div>
      <SubmitError state={submit.state} />
    </li>
  );
}

function ProjectHeading({ bound }: { bound: BoundProject }) {
  return (
    <span {...stylex.props(styles.rowText)}>
      <span {...stylex.props(styles.primaryText)}>{bound.project.name}</span>
      <Text variant="meta">{bound.connection.name}</Text>
    </span>
  );
}

export function MappingPanel({
  workspace,
  page,
  actions,
}: {
  workspace: WorkspaceSettings;
  page: SettingsPage;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings.mapping");
  return (
    <>
      <Text variant="body">{t("hint")}</Text>
      <Text variant="body">{t("permissionHint")}</Text>
      <Text variant="meta">{t("prTitleHint")}</Text>
      {page.runnerProjects.length === 0 ? (
        <Text variant="meta">{t("noRunnerProjects")}</Text>
      ) : null}
      {workspace.bound.length === 0 ? (
        <Text variant="meta">{t("noProjects")}</Text>
      ) : (
        <ul {...stylex.props(styles.list)}>
          {workspace.bound.map((bound) => (
            <MappingRow
              key={`${bound.connection.id}/${bound.project.id}`}
              ws={workspace.general.id}
              bound={bound}
              runnerProjects={page.runnerProjects}
              agents={page.agents}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function MappingRow({
  ws,
  bound,
  runnerProjects,
  agents,
  actions,
}: {
  ws: string;
  bound: BoundProject;
  runnerProjects: Choice[];
  agents: string[];
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const agentName = useAgentName();
  const [runnerProject, setRunnerProject] = useState(bound.mapping?.runnerProject ?? null);
  const [agent, setAgent] = useState(bound.mapping?.agent ?? null);
  const [model, setModel] = useState(bound.mapping?.model ?? "");
  const submit = useSubmit();
  const projectOptions = withCurrent(
    runnerProjects.map((p) => ({ value: p.id, label: p.name })),
    bound.mapping?.runnerProject,
  );
  return (
    <li {...stylex.props(styles.item)}>
      <form
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          if (runnerProject === null || agent === null) return;
          submit.run(
            () =>
              actions.saveMapping({
                ws,
                connectionId: bound.connection.id,
                projectId: bound.project.id,
                runnerProjectId: runnerProject,
                agentId: agent,
                model: model.trim(),
              }),
            t("saved"),
          );
        }}
      >
        <ProjectHeading bound={bound} />
        <div {...stylex.props(styles.fieldRow)}>
          <Field label={t("mapping.runnerProject")}>
            <Select
              options={projectOptions}
              value={runnerProject}
              onValueChange={setRunnerProject}
              placeholder={t("mapping.choose")}
            />
          </Field>
          <Field label={t("mapping.agent")}>
            <Select
              options={agents.map((a) => ({ value: a, label: agentName(a) }))}
              value={agent}
              onValueChange={setAgent}
              placeholder={t("mapping.choose")}
            />
          </Field>
        </div>
        <Field label={t("mapping.model")} description={t("mapping.modelDescription")}>
          <Input
            name="model"
            value={model}
            onValueChange={setModel}
            placeholder={t("mapping.modelPlaceholder")}
            autoComplete="off"
            mono
          />
        </Field>
        <SubmitError state={submit.state} />
        <Actions>
          <Button
            type="submit"
            disabled={submit.sending || runnerProject === null || agent === null}
          >
            {submit.sending ? t("saving") : t("save")}
          </Button>
        </Actions>
      </form>
    </li>
  );
}

/** 저장된 값이 목록에 없어도(러너에서 사라짐 등) 그 값을 고른 채로 보이게 더한다 */
function withCurrent(
  options: ReadonlyArray<{ value: string; label: string }>,
  current: string | null | undefined,
): Array<{ value: string; label: string }> {
  if (current === null || current === undefined || options.some((o) => o.value === current)) {
    return [...options];
  }
  return [...options, { value: current, label: current }];
}

export function ProgressPanel({
  workspace,
  actions,
}: {
  workspace: WorkspaceSettings;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  return (
    <>
      <Text variant="body">{t("progress.hint")}</Text>
      {workspace.bound.length === 0 ? (
        <Text variant="meta">{t("mapping.noProjects")}</Text>
      ) : (
        <ul {...stylex.props(styles.list)}>
          {workspace.bound.map((bound) => (
            <ProgressRow
              key={`${bound.connection.id}/${bound.project.id}`}
              ws={workspace.general.id}
              bound={bound}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function ProgressRow({
  ws,
  bound,
  actions,
}: {
  ws: string;
  bound: BoundProject;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const reason = useReason();
  const [stateId, setStateId] = useState(bound.inProgressStateId);
  const submit = useSubmit();
  const options = withCurrent(
    bound.states.ok ? bound.states.items.map((s) => ({ value: s.id, label: s.name })) : [],
    bound.inProgressStateId,
  );
  return (
    <li {...stylex.props(styles.item)}>
      <form
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          if (stateId === null) return;
          submit.run(
            () =>
              actions.saveInProgress({
                ws,
                connectionId: bound.connection.id,
                projectId: bound.project.id,
                stateId,
              }),
            t("saved"),
          );
        }}
      >
        <ProjectHeading bound={bound} />
        {bound.states.ok ? null : (
          <p {...stylex.props(styles.error)}>
            {t("progress.listFailed", { reason: reason(bound.states.error) })}
          </p>
        )}
        <Field label={t("progress.state")}>
          <Select
            options={options}
            value={stateId}
            onValueChange={setStateId}
            placeholder={t("progress.choose")}
          />
        </Field>
        <SubmitError state={submit.state} />
        <Actions>
          <Button type="submit" disabled={submit.sending || stateId === null}>
            {submit.sending ? t("saving") : t("save")}
          </Button>
        </Actions>
      </form>
    </li>
  );
}

export function LabelPanel({
  workspace,
  actions,
}: {
  workspace: WorkspaceSettings;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  return (
    <>
      <Text variant="body">{t("label.hint")}</Text>
      {workspace.labels.length === 0 ? (
        <Text variant="meta">{t("mapping.noProjects")}</Text>
      ) : (
        <ul {...stylex.props(styles.list)}>
          {workspace.labels.map((label) => (
            <LabelRow
              key={label.connection.id}
              ws={workspace.general.id}
              label={label}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function LabelRow({
  ws,
  label,
  actions,
}: {
  ws: string;
  label: ConnectionLabel;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const reason = useReason();
  const [labelId, setLabelId] = useState(label.labelId);
  const submit = useSubmit();
  const options = label.labels.ok
    ? label.labels.items.map((l) => ({ value: l.id, label: l.name }))
    : [];
  const current = label.labelId;
  const allOptions =
    current === null || options.some((o) => o.value === current)
      ? options
      : [...options, { value: current, label: t("label.unknown", { id: current }) }];
  return (
    <li {...stylex.props(styles.item)}>
      <form
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          if (labelId === null) return;
          submit.run(
            () => actions.saveLabel({ ws, connectionId: label.connection.id, labelId }),
            t("saved"),
          );
        }}
      >
        <span {...stylex.props(styles.primaryText)}>{label.connection.name}</span>
        {label.labels.ok ? null : (
          <p {...stylex.props(styles.error)}>
            {t("label.listFailed", { reason: reason(label.labels.error) })}
          </p>
        )}
        <Field label={t("label.label")}>
          <Select
            options={allOptions}
            value={labelId}
            onValueChange={setLabelId}
            placeholder={t("label.choose")}
          />
        </Field>
        <SubmitError state={submit.state} />
        <Actions>
          <Button type="submit" disabled={submit.sending || labelId === null}>
            {submit.sending ? t("saving") : t("save")}
          </Button>
        </Actions>
      </form>
    </li>
  );
}

// ---------- 설치 전체 ----------

function ConnectionsPanel({
  connections,
  actions,
}: {
  connections: TrackerConnectionView[];
  actions: SettingsActions;
}) {
  const t = useTranslations("settings.connections");
  return (
    <>
      <Text variant="body">{t("hint")}</Text>
      {connections.length === 0 ? null : (
        <ul {...stylex.props(styles.list)}>
          {connections.map((connection) => (
            <li key={connection.id} {...stylex.props(styles.item)}>
              <ConnectionForm connection={connection} actions={actions} />
            </li>
          ))}
        </ul>
      )}
      <PanelBlock title={t("addTitle")}>
        <ConnectionForm connection={null} actions={actions} />
      </PanelBlock>
    </>
  );
}

/** 연결 하나를 고치거나(connection) 새로 더한다(null) */
export function ConnectionForm({
  connection,
  actions,
}: {
  connection: TrackerConnectionView | null;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const [name, setName] = useState(connection?.name ?? "");
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const submit = useSubmit();
  const check = useSubmit();
  const isNew = connection === null;
  const ready = name.trim() !== "" && (!isNew || apiKey.trim() !== "");
  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        submit.run(
          () =>
            actions.saveConnection({
              ...(connection === null ? {} : { id: connection.id }),
              name: name.trim(),
              apiKey: apiKey.trim(),
              webhookSecret: webhookSecret.trim(),
            }),
          isNew ? t("connections.added") : t("saved"),
          () => {
            setApiKey("");
            setWebhookSecret("");
            if (isNew) setName("");
          },
        );
      }}
    >
      {connection === null ? null : (
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.rowText)}>
            <span {...stylex.props(styles.primaryText)}>{connection.name}</span>
            <Text variant="meta">
              {connection.hasWebhookSecret
                ? t("connections.secretSet")
                : t("connections.secretUnset")}
            </Text>
          </span>
          <Button
            variant="ghost"
            disabled={check.sending}
            onClick={() =>
              check.run(
                () => actions.checkConnection({ id: connection.id }),
                t("connections.checkOk", { name: connection.name }),
              )
            }
          >
            {check.sending ? t("connections.checking") : t("connections.check")}
          </Button>
        </div>
      )}
      <SubmitError state={check.state} />
      {connection === null ? null : (
        <Field
          label={t("connections.webhookPath")}
          description={t("connections.webhookPathDescription")}
        >
          <Input value={connection.webhookPath} readOnly mono />
        </Field>
      )}
      <Field label={t("connections.name")}>
        <Input
          name="name"
          value={name}
          onValueChange={setName}
          placeholder={t("connections.namePlaceholder")}
          autoComplete="off"
        />
      </Field>
      <Field
        label={t("connections.apiKey")}
        description={isNew ? t("connections.apiKeyDescription") : t("connections.apiKeyKeep")}
      >
        <Input
          name="apiKey"
          type="password"
          value={apiKey}
          onValueChange={setApiKey}
          autoComplete="new-password"
          mono
        />
      </Field>
      <Field
        label={t("connections.webhookSecret")}
        description={
          isNew ? t("connections.webhookSecretDescription") : t("connections.webhookSecretKeep")
        }
      >
        <Input
          name="webhookSecret"
          type="password"
          value={webhookSecret}
          onValueChange={setWebhookSecret}
          autoComplete="new-password"
          mono
        />
      </Field>
      <SubmitError state={submit.state} />
      <Actions>
        <Button
          variant={isNew ? "primary" : "secondary"}
          type="submit"
          disabled={submit.sending || !ready}
        >
          {submit.sending ? t("saving") : isNew ? t("connections.add") : t("connections.saveEdit")}
        </Button>
      </Actions>
    </form>
  );
}

// ---------- 주소(0048) ----------

/**
 * 다른 기기에서 열 주소와 webhook 공개 주소. 서버는 이 주소의 호스트로 온 요청만 받는다(Host 검사).
 * 127.0.0.1 로 연 화면은 늘 열려, 잘못 넣어도 이 기계에서 고칠 수 있다.
 */
function AddressesPanel({
  addresses,
  actions,
}: {
  addresses: AddressesView;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings.addresses");
  const ts = useTranslations("settings");
  const [webAddress, setWebAddress] = useState(addresses.webAddress ?? "");
  const [webhookAddress, setWebhookAddress] = useState(addresses.webhookAddress ?? "");
  const submit = useSubmit();
  return (
    <>
      <PanelBlock>
        <ul {...stylex.props(styles.bullets)}>
          <li>{t("intro")}</li>
          <li>{t("loopback")}</li>
        </ul>
      </PanelBlock>
      <form
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          submit.run(
            () =>
              actions.saveAddresses({
                webAddress: webAddress.trim(),
                webhookAddress: webhookAddress.trim(),
              }),
            ts("saved"),
          );
        }}
      >
        <Field label={t("web")} description={t("webDescription")}>
          <Input
            name="webAddress"
            type="url"
            value={webAddress}
            onValueChange={setWebAddress}
            placeholder={t("webPlaceholder")}
            mono
          />
        </Field>
        <Field label={t("webhook")} description={t("webhookDescription")}>
          <Input
            name="webhookAddress"
            type="url"
            value={webhookAddress}
            onValueChange={setWebhookAddress}
            placeholder={t("webhookPlaceholder")}
            mono
          />
        </Field>
        <SubmitError state={submit.state} />
        <Actions>
          <Button variant="primary" type="submit" disabled={submit.sending}>
            {submit.sending ? ts("saving") : t("save")}
          </Button>
        </Actions>
      </form>
    </>
  );
}

/**
 * 온보딩 트래커 단계의 webhook 공개 주소 칸(0048). 다른 기기에서 열 주소는 그대로 두고 webhook 공개 주소만 바꾼다.
 */
export function WebhookAddressForm({
  addresses,
  actions,
}: {
  addresses: AddressesView;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings.addresses");
  const ts = useTranslations("settings");
  const [webhookAddress, setWebhookAddress] = useState(addresses.webhookAddress ?? "");
  const submit = useSubmit();
  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        submit.run(
          () =>
            actions.saveAddresses({
              webAddress: addresses.webAddress ?? "",
              webhookAddress: webhookAddress.trim(),
            }),
          ts("saved"),
        );
      }}
    >
      <Field label={t("webhook")} description={t("webhookDescription")}>
        <Input
          name="webhookAddress"
          type="url"
          value={webhookAddress}
          onValueChange={setWebhookAddress}
          placeholder={t("webhookPlaceholder")}
          mono
        />
      </Field>
      <SubmitError state={submit.state} />
      <Actions>
        <Button variant="secondary" type="submit" disabled={submit.sending}>
          {submit.sending ? ts("saving") : t("saveWebhook")}
        </Button>
      </Actions>
    </form>
  );
}

export function GitHubPanel({ saved, actions }: { saved: boolean; actions: SettingsActions }) {
  const t = useTranslations("settings");
  const [token, setToken] = useState("");
  const submit = useSubmit();
  const check = useSubmit();
  return (
    <>
      <div {...stylex.props(styles.row)}>
        <Text variant="body">{saved ? t("github.stateSet") : t("github.stateUnset")}</Text>
        {saved ? (
          <Button
            variant="ghost"
            disabled={check.sending}
            onClick={() => check.run(() => actions.checkGitHubToken(), t("github.checkOk"))}
          >
            {check.sending ? t("github.checking") : t("github.check")}
          </Button>
        ) : null}
      </div>
      <SubmitError state={check.state} />
      <PanelBlock>
        <ul {...stylex.props(styles.bullets)}>
          <li>{t("github.required")}</li>
          <li>{t("github.optional")}</li>
        </ul>
      </PanelBlock>
      <form
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          if (token.trim() === "") return;
          submit.run(
            () => actions.saveGitHubToken({ token: token.trim() }),
            t("saved"),
            () => setToken(""),
          );
        }}
      >
        <Field
          label={t("github.token")}
          description={saved ? t("github.tokenKeep") : t("github.tokenDescription")}
        >
          <Input
            name="token"
            type="password"
            value={token}
            onValueChange={setToken}
            autoComplete="new-password"
            mono
          />
        </Field>
        <SubmitError state={submit.state} />
        <Actions>
          <Button variant="primary" type="submit" disabled={submit.sending || token.trim() === ""}>
            {submit.sending ? t("saving") : t("github.save")}
          </Button>
        </Actions>
      </form>
    </>
  );
}

function RunnersPanel({
  runners,
  actions,
  workerSilent,
  workspaceId,
}: {
  runners: RunnerSettingsView[];
  actions: SettingsActions;
  workerSilent: boolean;
  /** Runners 로 가도 사이드바의 Workspace 를 이어 가게 주소에 남긴다 */
  workspaceId: string | null;
}) {
  const t = useTranslations("settings.runners");
  const runnersHref =
    workspaceId === null
      ? "/runners"
      : `/runners?${new URLSearchParams({ ws: workspaceId }).toString()}`;
  return (
    <>
      <Text variant="body">
        {t("hint")}{" "}
        <a href={runnersHref} {...stylex.props(styles.link)}>
          {t("toRunners")}
        </a>
      </Text>
      {runners.length === 0 ? null : (
        <ul {...stylex.props(styles.list)}>
          {runners.map((runner) => (
            <li key={runner.id} {...stylex.props(styles.item)}>
              <RunnerCheck runner={runner} actions={actions} workerSilent={workerSilent} />
              <RunnerForm runner={runner} actions={actions} />
            </li>
          ))}
        </ul>
      )}
      <PanelBlock title={t("addTitle")}>
        <RunnerForm runner={null} actions={actions} />
      </PanelBlock>
    </>
  );
}

export function RunnerForm({
  runner,
  actions,
}: {
  runner: RunnerSettingsView | null;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const [name, setName] = useState(runner?.name ?? "");
  const [sshTarget, setSshTarget] = useState(runner?.sshTarget ?? "");
  const [orcaPath, setOrcaPath] = useState(runner?.orcaPath ?? "");
  const [capacity, setCapacity] = useState(String(runner?.capacity ?? 1));
  const submit = useSubmit();
  const isNew = runner === null;
  const capacityValue = parseWholeNumber(capacity);
  const capacityOk = capacityValue !== null && capacityValue >= 1 && capacityValue <= 100;
  const ready =
    name.trim() !== "" && sshTarget.trim() !== "" && orcaPath.trim() !== "" && capacityOk;
  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || capacityValue === null) return;
        submit.run(
          () =>
            actions.saveRunner({
              ...(runner === null ? {} : { id: runner.id }),
              name: name.trim(),
              sshTarget: sshTarget.trim(),
              orcaPath: orcaPath.trim(),
              capacity: capacityValue,
            }),
          isNew ? t("runners.added") : t("runners.savedAndChecking"),
          () => {
            if (!isNew) return;
            setName("");
            setSshTarget("");
            setOrcaPath("");
            setCapacity("1");
          },
        );
      }}
    >
      <div {...stylex.props(styles.fieldRow)}>
        <Field label={t("runners.name")}>
          <Input
            name="name"
            value={name}
            onValueChange={setName}
            placeholder={t("runners.namePlaceholder")}
            autoComplete="off"
          />
        </Field>
        <Field
          label={t("runners.capacity")}
          error={capacityOk ? undefined : t("runners.capacityInvalid")}
        >
          <Input
            name="capacity"
            value={capacity}
            onValueChange={setCapacity}
            autoComplete="off"
            mono
          />
        </Field>
      </div>
      <Field label={t("runners.sshTarget")} description={t("runners.sshTargetDescription")}>
        <Input
          name="sshTarget"
          value={sshTarget}
          onValueChange={setSshTarget}
          placeholder={t("runners.sshTargetPlaceholder")}
          autoComplete="off"
          mono
        />
      </Field>
      <Field label={t("runners.orcaPath")} description={t("runners.orcaPathDescription")}>
        <Input
          name="orcaPath"
          value={orcaPath}
          onValueChange={setOrcaPath}
          autoComplete="off"
          mono
        />
      </Field>
      <SubmitError state={submit.state} />
      <Actions>
        <Button
          variant={isNew ? "primary" : "secondary"}
          type="submit"
          disabled={submit.sending || !ready}
        >
          {submit.sending ? t("saving") : isNew ? t("runners.add") : t("runners.save")}
        </Button>
      </Actions>
    </form>
  );
}

/** 러너 확인 요청과 worker 가 쓴 결과. 필수 조건을 하나씩 보인다(스펙 9절) */
export function RunnerCheck({
  runner,
  actions,
  workerSilent,
}: {
  runner: RunnerSettingsView;
  actions: SettingsActions;
  workerSilent: boolean;
}) {
  const t = useTranslations("settings.runners");
  const submit = useSubmit();
  const check = runner.check;
  return (
    <div {...stylex.props(styles.form)}>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.rowText)}>
          <span {...stylex.props(styles.primaryText)}>{runner.name}</span>
          <Text variant="meta" mono truncate>
            {runner.sshTarget}
          </Text>
        </span>
        <Button
          variant="ghost"
          disabled={submit.sending || (check?.status === "pending" && !workerSilent)}
          onClick={() =>
            submit.run(() => actions.recheckRunner({ id: runner.id }), t("checkRequested"))
          }
        >
          {t("recheck")}
        </Button>
      </div>
      <SubmitError state={submit.state} />
      <PanelBlock title={t("check.title")}>
        <CheckResult check={check} workerSilent={workerSilent} />
      </PanelBlock>
    </div>
  );
}

function CheckResult({
  check,
  workerSilent,
}: {
  check: RunnerCheckView | null;
  workerSilent: boolean;
}) {
  const t = useTranslations("settings.runners.check");
  const runnerError = useRunnerErrorName();
  const statusName = useStatusName();
  const format = useFormatter();
  if (check === null) return <Text variant="meta">{t("never")}</Text>;
  switch (check.status) {
    case "pending":
      return (
        <p role="status" {...stylex.props(styles.secondaryText, styles.para)}>
          {workerSilent ? t("workerSilent") : t("pending")}
        </p>
      );
    case "failed":
      return <p {...stylex.props(styles.error)}>{t("failed", { error: check.error })}</p>;
    case "unreadable":
      return <p {...stylex.props(styles.error)}>{t("unreadable")}</p>;
    case "done":
      return (
        <div {...stylex.props(styles.form)}>
          <span {...stylex.props(styles.inline)}>
            <StatusPill status={check.online ? "online" : "offline"}>
              {statusName(check.online ? "online" : "offline")}
            </StatusPill>
            {check.online
              ? check.version === null
                ? t("online")
                : t("onlineVersion", { version: check.version })
              : check.error === null
                ? t("offline")
                : t("offlineReason", { reason: runnerError(check.error) })}
          </span>
          {check.prerequisites.length === 0 ? null : (
            <ul {...stylex.props(styles.list)}>
              {check.prerequisites.map((prerequisite) => (
                <Prerequisite key={prerequisite.id} prerequisite={prerequisite} />
              ))}
            </ul>
          )}
          <Text variant="meta">
            {t("checkedAt", {
              time: format.dateTime(new Date(check.completedAt), {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
          </Text>
        </div>
      );
  }
}

/** 러너 오류 종류(core RunnerErrorDetail.kind)를 문구로 바꾼다. 모르는 종류는 그대로 보인다 */
export function useRunnerErrorName(): (kind: string) => string {
  const t = useTranslations("settings.runners.check.errorKind");
  return (kind) => {
    switch (kind) {
      case "unreachable":
      case "not-installed":
      case "not-ready":
      case "mailbox-missing":
      case "runner-error":
      case "start-outcome-unknown":
      case "malformed-output":
        return t(kind);
      default:
        return kind;
    }
  };
}

function Prerequisite({ prerequisite }: { prerequisite: PrerequisiteView }) {
  const t = useTranslations("settings.runners.check");
  const prerequisiteName = usePrerequisiteName();
  const broken = prerequisite.satisfied === false;
  const hint = prerequisiteHint(prerequisite);
  return (
    <li {...stylex.props(styles.item, styles.prerequisite)}>
      <span {...stylex.props(styles.inline)}>
        <span {...stylex.props(styles.primaryText)}>{prerequisiteName(prerequisite)}</span>
        <Text variant="meta">
          {prerequisite.satisfied === null
            ? t("unknown")
            : prerequisite.satisfied
              ? t("satisfied")
              : t("unsatisfied")}
        </Text>
      </span>
      {broken && hint !== null ? (
        <Text variant="meta" mono>
          {hint}
        </Text>
      ) : null}
      {broken && prerequisite.blocksAssignment ? (
        <div {...stylex.props(styles.fix)}>
          <p {...stylex.props(styles.error)}>{t("blocked")}</p>
          <Text variant="label">{t("fixTitle")}</Text>
          <ul {...stylex.props(styles.bullets)}>
            <li>{t("fixToken")}</li>
            <li>{t("fixSsh")}</li>
          </ul>
        </div>
      ) : null}
    </li>
  );
}

/** "12" 같은 자연수 글을 숫자로 바꾼다. 아니면 null */
function parseWholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

const styles = stylex.create({
  titleCell: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  form: { display: "flex", flexDirection: "column", gap: space.s4, maxWidth: 640 },
  fieldRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: space.s3,
  },
  list: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    maxWidth: 640,
  },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    paddingBlock: space.s4,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  prerequisite: { gap: space.s1, paddingBlock: space.s2 },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
    maxWidth: 640,
  },
  rowText: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  inline: { display: "inline-flex", alignItems: "center", gap: space.px6 },
  primaryText: { color: colors.textPrimary },
  secondaryText: { color: colors.textSecondary },
  disabledText: { color: colors.textDisabled },
  para: { margin: 0 },
  error: { margin: 0, color: colors.problem },
  fix: { display: "flex", flexDirection: "column", gap: space.s1 },
  bullets: {
    margin: 0,
    paddingInlineStart: space.s5,
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    color: colors.textSecondary,
  },
  link: {
    color: colors.accentText,
    textDecoration: { default: "none", ":hover": "underline" },
    textUnderlineOffset: 3,
  },
});

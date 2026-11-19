import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  Checkbox,
  CodeBlock,
  DetailPanel,
  Dialog,
  DialogClose,
  DividedItem,
  DividedList,
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
  linkStyles,
  showToast,
  textStyles,
} from "@ganger/ui";
import { size, space } from "@ganger/ui/tokens.stylex";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
} from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { isPushCheck, prerequisiteHint, summarizePushChecks } from "@ganger/app/prerequisites";
import { isMcpRejectReason, isMcpWriteTool } from "@ganger/app/mcp/actions";
import type { McpActionView } from "@ganger/app/mcp/actions";
import { hermesConfig, jsonConfig } from "@ganger/app/settings/mcp-launch";
import { useAgentName, usePrerequisiteName } from "../labels";
import { PushProblems } from "../push-check";
import { browserClipboard, copyText } from "./clipboard";
import { DEFAULT_ORCA_PATH } from "@ganger/runner-orca/config";
import { shellQuote } from "../onboarding/model";
import { useStatusName } from "../status";
import {
  INSTALL_ITEMS,
  MAX_RUN_MINUTES,
  RUNNER_CHECK_POLL_LIMIT_MS,
  RUNNER_CHECK_POLL_MS,
  WORKSPACE_ITEMS,
} from "@ganger/app/settings/model";
import type {
  AddressesView,
  BoundProject,
  Choice,
  ConnectionLabel,
  ConnectionProjects,
  McpView,
  PowerView,
  PrerequisiteView,
  RunnerCheckView,
  RunnerSettingsView,
  SettingsItem,
  SettingsPage,
  TrackerConnectionView,
  TrackerProjectChoice,
  WorkspaceSettings,
} from "@ganger/app/settings/model";

export type ActionResult = { ok: true } | { ok: false; reason: string };

interface ProjectRef {
  ws: string;
  connectionId: string;
  projectId: string;
}

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
    name?: string;
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
  saveAddresses: (input: { webAddress: string; webhookAddress: string }) => Promise<ActionResult>;
  savePower: (input: { preventSleep: boolean }) => Promise<ActionResult>;
  saveMcpWrite: (input: { allowed: boolean }) => Promise<ActionResult>;
  pollRunnerChecks: () => Promise<boolean>;
}

export interface SettingsScreenProps {
  page: SettingsPage;
  selected: string | undefined;
  onSelect: (item: SettingsItem) => void;
  actions: SettingsActions;
  renderRunnersLink?: (props: RunnersLinkProps) => ReactNode;
}

export interface RunnersLinkProps {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

const ReportUnsavedContext = createContext<(formId: string, unsaved: boolean) => void>(() => {});

function useReportUnsaved(unsaved: boolean): void {
  const report = use(ReportUnsavedContext);
  const formId = useId();
  useEffect(() => {
    report(formId, unsaved);
  }, [report, formId, unsaved]);
  useEffect(() => () => report(formId, false), [report, formId]);
}

export function SettingsScreen({
  page,
  selected,
  onSelect,
  actions,
  renderRunnersLink,
}: SettingsScreenProps) {
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

  const [unsavedForms, setUnsavedForms] = useState<ReadonlySet<string>>(() => new Set());
  const reportUnsaved = useCallback((formId: string, unsaved: boolean) => {
    setUnsavedForms((prev) => {
      if (prev.has(formId) === unsaved) return prev;
      const next = new Set(prev);
      if (unsaved) next.add(formId);
      else next.delete(formId);
      return next;
    });
  }, []);
  const hasUnsaved = unsavedForms.size > 0;
  const summaryOrUnsaved = (item: SettingsItem, summary: ReactNode): ReactNode =>
    hasUnsaved && item === current ? t("unsaved") : summary;

  return (
    <SplitView
      variant="editor"
      list={
        <>
          <PageHeader title={t("title")} subtitle={t("subtitle")} />
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
                summary={(item) =>
                  summaryOrUnsaved(item, <WorkspaceSummary item={item} workspace={workspace} />)
                }
              />
            )}
          </Section>
          <Section title={t("installGroup")} note={t("installNote")}>
            <ItemList
              label={t("installListLabel")}
              items={INSTALL_ITEMS}
              selected={current}
              onSelect={onSelect}
              summary={(item) => summaryOrUnsaved(item, <InstallSummary item={item} page={page} />)}
            />
          </Section>
        </>
      }
      panel={
        <section aria-label={t("panelLabel")}>
          <DetailPanel>
            <PanelHeader
              status={
                <span {...stylex.props(styles.inline)}>
                  <Text variant="meta">
                    {workspace !== null && isWorkspaceItem(current)
                      ? t("scopeWorkspace", { name: workspace.general.name })
                      : t("scopeInstall")}
                  </Text>
                  <Text variant="label" role="status">
                    {hasUnsaved ? t("unsaved") : null}
                  </Text>
                </span>
              }
              title={t(`items.${current}`)}
            />
            <ReportUnsavedContext value={reportUnsaved}>
              <ItemPanel
                key={`${workspace?.general.id ?? ""}:${current}`}
                item={current}
                page={page}
                actions={actions}
                workerSilent={workerSilent}
                renderRunnersLink={renderRunnersLink}
              />
            </ReportUnsavedContext>
          </DetailPanel>
        </section>
      }
    />
  );
}

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
    case "power":
    case "mcp":
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
    case "power": {
      const { available, preventSleep } = page.install.power;
      if (!available) return t("powerUnavailable");
      return preventSleep ? t("powerOn") : t("powerOff");
    }
    case "mcp":
      return page.install.mcp.writeAllowed ? t("mcpWrite") : t("mcpRead");
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
  renderRunnersLink,
}: {
  item: SettingsItem;
  page: SettingsPage;
  actions: SettingsActions;
  workerSilent: boolean;
  renderRunnersLink: ((props: RunnersLinkProps) => ReactNode) | undefined;
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
          renderLink={renderRunnersLink}
        />
      );
    case "addresses":
      return <AddressesPanel addresses={page.install.addresses} actions={actions} />;
    case "power":
      return <PowerPanel power={page.install.power} actions={actions} />;
    case "mcp":
      return <McpPanel mcp={page.install.mcp} actions={actions} />;
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

export type SubmitState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "failed"; reason: string };

export function useSubmit() {
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

export function useReason(): (reason: string) => string {
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
      case "unavailable":
        return t("power.unavailable");
      case "orca-not-found":
      case "ssh-failed":
        return t(`runners.direct.error.${reason}`);
      default:
        return t("failed");
    }
  };
}

export function SubmitError({ state }: { state: SubmitState }) {
  const reason = useReason();
  if (state.kind !== "failed") return null;
  return (
    <Text variant="ui" as="p" tone="problem" role="alert">
      {reason(state.reason)}
    </Text>
  );
}

function useValidateAfterBlur() {
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const touch = (...inputNames: string[]) => {
    setTouched((prev) =>
      inputNames.every((name) => prev.has(name)) ? prev : new Set([...prev, ...inputNames]),
    );
  };
  return {
    isTouched: (inputName: string) => touched.has(inputName),
    touch,
    touchBlurredInput: (event: FocusEvent<HTMLFormElement>) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.name !== "") touch(target.name);
    },
  };
}

export const passwordManagerIgnoredSecretProps = {
  type: "password",
  autoComplete: "off",
  "data-1p-ignore": true,
  "data-lpignore": "true",
} as const;

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
  const validation = useValidateAfterBlur();
  useReportUnsaved(name.trim() !== general.name || minutes !== general.maxRunMinutes);
  return (
    <form
      {...stylex.props(styles.form)}
      onBlur={validation.touchBlurredInput}
      onSubmit={(event) => {
        event.preventDefault();
        validation.touch("name", "maxRunMinutes");
        if (!nameOk || minutes === null || !maxRunOk) return;
        submit.run(
          () => actions.saveGeneral({ ws: general.id, name: name.trim(), maxRunMinutes: minutes }),
          t("saved"),
        );
      }}
    >
      <Field
        label={t("general.name")}
        error={nameOk || !validation.isTouched("name") ? undefined : t("general.nameInvalid")}
      >
        <Input name="name" value={name} onValueChange={setName} autoComplete="off" />
      </Field>
      <Field
        label={t("general.maxRun")}
        description={t("general.maxRunDescription")}
        error={
          maxRunOk || !validation.isTouched("maxRunMinutes")
            ? undefined
            : t("general.maxRunInvalid")
        }
      >
        <Input
          name="maxRunMinutes"
          value={maxRun}
          onValueChange={setMaxRun}
          autoComplete="off"
          inputMode="numeric"
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
              <Text variant="ui" as="p" tone="problem">
                {t("projects.listFailed", { reason: reason(group.error) })}
              </Text>
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
    <DividedList>
      {group.projects.map((project) => (
        <ProjectRow
          key={project.id}
          project={project}
          refInput={{ ws, connectionId: group.connection.id, projectId: project.id }}
          actions={actions}
        />
      ))}
    </DividedList>
  );
}

type ProjectOwnerKind = TrackerProjectChoice["owner"]["kind"];

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
  const actionRef = useRef<HTMLSpanElement>(null);
  const focusActionAfterOwnerChange = useRef<{
    from: ProjectOwnerKind;
    to: ProjectOwnerKind;
  } | null>(null);
  const failed = submit.state.kind === "failed";
  useEffect(() => {
    const pending = focusActionAfterOwnerChange.current;
    if (pending === null) return;
    if (failed) {
      focusActionAfterOwnerChange.current = null;
      return;
    }
    if (submit.sending || owner.kind === pending.from) return;
    focusActionAfterOwnerChange.current = null;
    if (owner.kind === pending.to) actionRef.current?.querySelector("button")?.focus();
  }, [owner.kind, submit.sending, failed]);
  return (
    <DividedItem>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.rowText)}>
          <Text variant="ui" tone={owner.kind === "other" ? "disabled" : "strong"}>
            {project.name}
          </Text>
          {owner.kind === "free" ? null : (
            <Text variant="meta">
              {owner.kind === "this"
                ? t("inThis")
                : t("inOther", { workspace: owner.workspace.name })}
            </Text>
          )}
        </span>
        <span ref={actionRef} {...stylex.props(styles.action)}>
          {owner.kind === "this" ? (
            <Dialog
              trigger={t("remove")}
              triggerVariant="danger"
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
                    variant="danger"
                    onClick={() => {
                      focusActionAfterOwnerChange.current = { from: "this", to: "free" };
                      submit.run(
                        () => actions.removeProject(refInput),
                        t("removed", { project: project.name }),
                      );
                    }}
                  >
                    {t("remove")}
                  </DialogClose>
                </>
              }
            />
          ) : (
            <Button
              disabled={owner.kind === "other" || submit.sending}
              onClick={() => {
                focusActionAfterOwnerChange.current = { from: "free", to: "this" };
                submit.run(
                  () => actions.addProject({ ...refInput, name: project.name }),
                  t("added", { project: project.name }),
                );
              }}
            >
              {t("add")}
            </Button>
          )}
        </span>
      </div>
      <SubmitError state={submit.state} />
    </DividedItem>
  );
}

function ProjectHeading({ bound }: { bound: BoundProject }) {
  return (
    <span {...stylex.props(styles.rowText)}>
      <Text variant="ui" tone="strong">
        {bound.project.name}
      </Text>
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
        <DividedList>
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
        </DividedList>
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
  useReportUnsaved(
    runnerProject !== (bound.mapping?.runnerProject ?? null) ||
      agent !== (bound.mapping?.agent ?? null) ||
      model.trim() !== (bound.mapping?.model ?? ""),
  );
  const projectOptions = withCurrent(
    runnerProjects.map((p) => ({ value: p.id, label: p.name })),
    bound.mapping?.runnerProject,
  );
  return (
    <DividedItem>
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
    </DividedItem>
  );
}

export function withCurrent(
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
        <DividedList>
          {workspace.bound.map((bound) => (
            <ProgressRow
              key={`${bound.connection.id}/${bound.project.id}`}
              ws={workspace.general.id}
              bound={bound}
              actions={actions}
            />
          ))}
        </DividedList>
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
  useReportUnsaved(stateId !== bound.inProgressStateId);
  const options = withCurrent(
    bound.states.ok ? bound.states.items.map((s) => ({ value: s.id, label: s.name })) : [],
    bound.inProgressStateId,
  );
  return (
    <DividedItem>
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
          <Text variant="ui" as="p" tone="problem">
            {t("progress.listFailed", { reason: reason(bound.states.error) })}
          </Text>
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
    </DividedItem>
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
        <DividedList>
          {workspace.labels.map((label) => (
            <LabelRow
              key={label.connection.id}
              ws={workspace.general.id}
              label={label}
              actions={actions}
            />
          ))}
        </DividedList>
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
  useReportUnsaved(labelId !== label.labelId);
  const options = label.labels.ok
    ? label.labels.items.map((l) => ({ value: l.id, label: l.name }))
    : [];
  const current = label.labelId;
  const allOptions =
    current === null || options.some((o) => o.value === current)
      ? options
      : [...options, { value: current, label: t("label.unknown", { id: current }) }];
  return (
    <DividedItem>
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
        <Text variant="ui" tone="strong">
          {label.connection.name}
        </Text>
        {label.labels.ok ? null : (
          <Text variant="ui" as="p" tone="problem">
            {t("label.listFailed", { reason: reason(label.labels.error) })}
          </Text>
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
    </DividedItem>
  );
}

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
        <DividedList>
          {connections.map((connection) => (
            <DividedItem key={connection.id}>
              <ConnectionForm connection={connection} actions={actions} />
            </DividedItem>
          ))}
        </DividedList>
      )}
      <PanelBlock title={t("addTitle")}>
        <ConnectionForm connection={null} actions={actions} />
      </PanelBlock>
    </>
  );
}

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
  useReportUnsaved(
    name.trim() !== (connection?.name ?? "") || apiKey !== "" || webhookSecret !== "",
  );
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
            <Text variant="ui" tone="strong">
              {connection.name}
            </Text>
            <Text variant="meta">
              {connection.hasWebhookSecret
                ? t("connections.secretSet")
                : t("connections.secretUnset")}
            </Text>
          </span>
          <Button
            variant="secondary"
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
          {...passwordManagerIgnoredSecretProps}
          value={apiKey}
          onValueChange={setApiKey}
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
          {...passwordManagerIgnoredSecretProps}
          value={webhookSecret}
          onValueChange={setWebhookSecret}
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
  const [submittedAddresses, setSubmittedAddresses] = useState({
    webAddress: addresses.webAddress ?? "",
    webhookAddress: addresses.webhookAddress ?? "",
  });
  useReportUnsaved(
    webAddress !== submittedAddresses.webAddress ||
      webhookAddress !== submittedAddresses.webhookAddress,
  );
  return (
    <>
      <PanelBlock>
        <ul {...stylex.props(textStyles("ui"), styles.bullets)}>
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
            () => setSubmittedAddresses({ webAddress, webhookAddress }),
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

function McpPanel({ mcp, actions }: { mcp: McpView; actions: SettingsActions }) {
  const t = useTranslations("settings.mcp");
  const { launch } = mcp;
  return (
    <>
      <PanelBlock>
        <ul {...stylex.props(textStyles("ui"), styles.bullets)}>
          <li>{t("intro")}</li>
          <li>{t("secrets")}</li>
          <li>{t("external")}</li>
          {launch.located ? null : <li>{t("notLocated")}</li>}
        </ul>
      </PanelBlock>
      <McpSnippet
        name={t("hermes")}
        description={t("hermesDescription")}
        text={hermesConfig(launch)}
      />
      <McpSnippet name={t("json")} description={t("jsonDescription")} text={jsonConfig(launch)} />
      <McpWriteForm allowed={mcp.writeAllowed} actions={actions} />
      <McpRecent recent={mcp.recent} now={mcp.now} />
    </>
  );
}

function McpWriteForm({ allowed, actions }: { allowed: boolean; actions: SettingsActions }) {
  const t = useTranslations("settings.mcp");
  const ts = useTranslations("settings");
  const [checked, setChecked] = useState(allowed);
  const [submitted, setSubmitted] = useState(allowed);
  const submit = useSubmit();
  useReportUnsaved(checked !== submitted);
  return (
    <PanelBlock title={t("writeTitle")}>
      <form
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          submit.run(
            () => actions.saveMcpWrite({ allowed: checked }),
            ts("saved"),
            () => setSubmitted(checked),
          );
        }}
      >
        <ul {...stylex.props(textStyles("ui"), styles.bullets)}>
          <li>{t("writeBlocked")}</li>
          <li>{t("writeRisk")}</li>
        </ul>
        <Checkbox
          name="mcpWriteAllowed"
          label={t("writeToggle")}
          description={t("writeToggleDescription")}
          checked={checked}
          onCheckedChange={setChecked}
        />
        <SubmitError state={submit.state} />
        <Actions>
          <Button variant="primary" type="submit" disabled={submit.sending}>
            {submit.sending ? ts("saving") : t("save")}
          </Button>
        </Actions>
      </form>
    </PanelBlock>
  );
}

function McpRecent({ recent, now }: { recent: ReadonlyArray<McpActionView>; now: string }) {
  const t = useTranslations("settings.mcp");
  const { stamp } = useTime();
  const toolName = (tool: string): string => (isMcpWriteTool(tool) ? t(`tool.${tool}`) : tool);
  return (
    <PanelBlock title={t("recentTitle")}>
      <div {...stylex.props(styles.snippet)}>
        <Text variant="ui" as="p" tone="muted">
          {t("recentNote")}
        </Text>
        {recent.length === 0 ? (
          <Text variant="meta">{t("recentEmpty")}</Text>
        ) : (
          <DividedList>
            {recent.map((action, index) => (
              <DividedItem key={`${action.at}-${index}`}>
                <div {...stylex.props(styles.row)}>
                  <span {...stylex.props(styles.rowText)}>
                    <Text variant="ui" tone="strong">
                      {t("actor", { client: action.client })}
                    </Text>
                    <Text variant="meta">
                      {t("detail", {
                        tool: toolName(action.tool),
                        target: action.target ?? "",
                        hasTarget: action.target === null ? "no" : "yes",
                      })}
                    </Text>
                    {action.outcome === "done" ? null : (
                      <Text variant="meta" tone="problem">
                        {isMcpRejectReason(action.reason)
                          ? t("rejected", { reason: t(`reason.${action.reason}`) })
                          : t("rejectedUnknown")}
                      </Text>
                    )}
                  </span>
                  <time dateTime={action.at} {...stylex.props(textStyles("meta"))}>
                    {stamp(action.at, now)}
                  </time>
                </div>
              </DividedItem>
            ))}
          </DividedList>
        )}
      </div>
    </PanelBlock>
  );
}

function McpSnippet({
  name,
  description,
  text,
}: {
  name: string;
  description: string;
  text: string;
}) {
  const t = useTranslations("settings.mcp");
  const copy = () => {
    void copyText(text, browserClipboard()).then((copied) =>
      showToast(copied ? t("copied", { name }) : t("copyFailed")),
    );
  };
  return (
    <PanelBlock title={name}>
      <div {...stylex.props(styles.snippet)}>
        <Text variant="ui" as="p" tone="muted">
          {description}
        </Text>
        <CodeBlock tone="command" label={name}>
          {text}
        </CodeBlock>
        <Actions>
          <Button variant="secondary" onClick={copy}>
            {t("copy", { name })}
          </Button>
        </Actions>
      </div>
    </PanelBlock>
  );
}

function PowerPanel({ power, actions }: { power: PowerView; actions: SettingsActions }) {
  const t = useTranslations("settings.power");
  const ts = useTranslations("settings");
  const [preventSleep, setPreventSleep] = useState(power.preventSleep);
  const [submitted, setSubmitted] = useState(power.preventSleep);
  const submit = useSubmit();
  useReportUnsaved(preventSleep !== submitted);
  return (
    <>
      <PanelBlock>
        <ul {...stylex.props(textStyles("ui"), styles.bullets)}>
          <li>{t("intro")}</li>
          <li>{t("lid")}</li>
          <li>{t("runners")}</li>
        </ul>
      </PanelBlock>
      <form
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          submit.run(
            () => actions.savePower({ preventSleep }),
            ts("saved"),
            () => setSubmitted(preventSleep),
          );
        }}
      >
        <Checkbox
          name="preventSleep"
          label={t("toggle")}
          description={power.available ? t("toggleDescription") : t("unavailable")}
          checked={preventSleep}
          onCheckedChange={setPreventSleep}
          disabled={!power.available}
        />
        <SubmitError state={submit.state} />
        <Actions>
          <Button variant="primary" type="submit" disabled={!power.available || submit.sending}>
            {submit.sending ? ts("saving") : t("save")}
          </Button>
        </Actions>
      </form>
    </>
  );
}

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
  useReportUnsaved(token !== "");
  return (
    <>
      <div {...stylex.props(styles.row)}>
        <Text variant="body">{saved ? t("github.stateSet") : t("github.stateUnset")}</Text>
        {saved ? (
          <Button
            variant="secondary"
            disabled={check.sending}
            onClick={() => check.run(() => actions.checkGitHubToken(), t("github.checkOk"))}
          >
            {check.sending ? t("github.checking") : t("github.check")}
          </Button>
        ) : null}
      </div>
      <SubmitError state={check.state} />
      <PanelBlock>
        <ul {...stylex.props(textStyles("ui"), styles.bullets)}>
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
            {...passwordManagerIgnoredSecretProps}
            value={token}
            onValueChange={setToken}
            mono
          />
        </Field>
        <SubmitError state={submit.state} />
        <Actions>
          <Button
            variant={saved ? "secondary" : "primary"}
            type="submit"
            disabled={submit.sending || token.trim() === ""}
          >
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
  renderLink,
}: {
  runners: RunnerSettingsView[];
  actions: SettingsActions;
  workerSilent: boolean;
  workspaceId: string | null;
  renderLink: ((props: RunnersLinkProps) => ReactNode) | undefined;
}) {
  const t = useTranslations("settings.runners");
  const runnersHref =
    workspaceId === null
      ? "/runners"
      : `/runners?${new URLSearchParams({ ws: workspaceId }).toString()}`;
  const linkProps: RunnersLinkProps = { ...stylex.props(linkStyles()), children: t("toRunners") };
  return (
    <>
      <Text variant="body">
        {t("hint")}{" "}
        {renderLink === undefined ? <a href={runnersHref} {...linkProps} /> : renderLink(linkProps)}
      </Text>
      {runners.length === 0 ? null : (
        <DividedList>
          {runners.map((runner) => (
            <DividedItem key={runner.id}>
              <RunnerCheck runner={runner} actions={actions} workerSilent={workerSilent} />
              <RunnerForm runner={runner} actions={actions} />
            </DividedItem>
          ))}
        </DividedList>
      )}
      <PanelBlock title={t("addTitle")}>
        <RunnerForm runner={null} actions={actions} />
      </PanelBlock>
    </>
  );
}

export function nameFromSshTarget(sshTarget: string): string {
  const host = sshTarget.trim().split("@").at(-1) ?? "";
  if (host.startsWith("["))
    return host.slice(1, host.indexOf("]") === -1 ? undefined : host.indexOf("]"));
  if ((host.match(/:/gu)?.length ?? 0) > 1) return host;
  const withoutPort = host.split(":")[0] ?? "";
  if (/^\d+(\.\d+){3}$/u.test(withoutPort)) return withoutPort;
  return withoutPort.split(".")[0] ?? "";
}

export function sshCheckCommand(sshTarget: string): string {
  return ["ssh", "-o", "BatchMode=yes", "--", sshTarget, "true"].map(shellQuote).join(" ");
}

export function RunnerForm({
  runner,
  actions,
  primary = runner === null,
  direct = false,
}: {
  runner: RunnerSettingsView | null;
  actions: SettingsActions;
  primary?: boolean;
  direct?: boolean;
}) {
  const t = useTranslations("settings");
  const blankOrcaPath = direct ? DEFAULT_ORCA_PATH : "";
  const [name, setName] = useState(runner?.name ?? "");
  const [nameEdited, setNameEdited] = useState(false);
  const [sshTarget, setSshTarget] = useState(runner?.sshTarget ?? "");
  const [orcaPath, setOrcaPath] = useState(runner?.orcaPath ?? blankOrcaPath);
  const [capacity, setCapacity] = useState(String(runner?.capacity ?? 1));
  const submit = useSubmit();
  const isNew = runner === null;
  const capacityValue = parseWholeNumber(capacity);
  const capacityOk = capacityValue !== null && capacityValue >= 1 && capacityValue <= 100;
  const ready =
    name.trim() !== "" &&
    sshTarget.trim() !== "" &&
    (direct || orcaPath.trim() !== "") &&
    capacityOk;
  const validation = useValidateAfterBlur();
  useReportUnsaved(
    name.trim() !== (runner?.name ?? "") ||
      sshTarget.trim() !== (runner?.sshTarget ?? "") ||
      orcaPath.trim() !== (runner?.orcaPath ?? blankOrcaPath) ||
      capacityValue !== (runner?.capacity ?? 1),
  );
  const changeSshTarget = (value: string) => {
    setSshTarget(value);
    if (direct && isNew && !nameEdited) setName(nameFromSshTarget(value));
  };
  const changeName = (value: string) => {
    setName(value);
    setNameEdited(true);
  };
  const nameField = (
    <Field label={t("runners.name")}>
      <Input
        name="name"
        value={name}
        onValueChange={changeName}
        placeholder={t("runners.namePlaceholder")}
        autoComplete="off"
      />
    </Field>
  );
  const capacityField = (
    <Field
      label={direct ? t("runners.direct.capacity") : t("runners.capacity")}
      {...(direct ? { description: t("runners.direct.capacityDescription") } : {})}
      error={
        capacityOk || !validation.isTouched("capacity") ? undefined : t("runners.capacityInvalid")
      }
    >
      <Input
        name="capacity"
        value={capacity}
        onValueChange={setCapacity}
        autoComplete="off"
        inputMode="numeric"
        mono
      />
    </Field>
  );
  const sshTargetField = (
    <Field
      label={t("runners.sshTarget")}
      description={
        direct ? t("runners.direct.sshTargetDescription") : t("runners.sshTargetDescription")
      }
    >
      <Input
        name="sshTarget"
        value={sshTarget}
        onValueChange={changeSshTarget}
        placeholder={t("runners.sshTargetPlaceholder")}
        autoComplete="off"
        mono
      />
    </Field>
  );
  const orcaPathField = (
    <Field
      label={t("runners.orcaPath")}
      description={
        direct ? t("runners.direct.orcaPathDescription") : t("runners.orcaPathDescription")
      }
    >
      <Input name="orcaPath" value={orcaPath} onValueChange={setOrcaPath} autoComplete="off" mono />
    </Field>
  );
  return (
    <form
      {...stylex.props(styles.form)}
      onBlur={validation.touchBlurredInput}
      onSubmit={(event) => {
        event.preventDefault();
        validation.touch("capacity");
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
            setNameEdited(false);
            setSshTarget("");
            setOrcaPath(blankOrcaPath);
            setCapacity("1");
          },
        );
      }}
    >
      {direct ? (
        <>
          {sshTargetField}
          <div {...stylex.props(styles.fieldRow)}>
            {nameField}
            {capacityField}
          </div>
          {orcaPathField}
          <SshCheckCommand sshTarget={sshTarget.trim()} />
        </>
      ) : (
        <>
          <div {...stylex.props(styles.fieldRow)}>
            {nameField}
            {capacityField}
          </div>
          {sshTargetField}
          {orcaPathField}
        </>
      )}
      <SubmitError state={submit.state} />
      <Actions>
        <Button
          variant={primary ? "primary" : "secondary"}
          type="submit"
          disabled={submit.sending || !ready}
        >
          {submit.sending
            ? t("saving")
            : isNew
              ? direct
                ? t("runners.direct.submit")
                : t("runners.add")
              : t("runners.save")}
        </Button>
      </Actions>
    </form>
  );
}

function SshCheckCommand({ sshTarget }: { sshTarget: string }) {
  const t = useTranslations("settings.runners.direct");
  const empty = sshTarget === "";
  const command = sshCheckCommand(empty ? t("targetPlaceholder") : sshTarget);
  const copy = () => {
    void copyText(command, browserClipboard()).then((copied) =>
      showToast(copied ? t("copied") : t("copyFailed")),
    );
  };
  return (
    <PanelBlock title={t("tryFirst")}>
      <div {...stylex.props(styles.snippet)}>
        <CodeBlock tone="command" label={t("tryFirst")}>
          {command}
        </CodeBlock>
        <Actions>
          <Button variant="ghost" disabled={empty} onClick={copy}>
            {t("copy")}
          </Button>
        </Actions>
      </div>
    </PanelBlock>
  );
}

export function RunnerCheck({
  runner,
  actions,
  workerSilent,
  primary = false,
}: {
  runner: RunnerSettingsView;
  actions: SettingsActions;
  workerSilent: boolean;
  primary?: boolean;
}) {
  const t = useTranslations("settings.runners");
  const submit = useSubmit();
  const check = runner.check;
  const checking = submit.sending || (check?.status === "pending" && !workerSilent);
  return (
    <div {...stylex.props(styles.form)}>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.rowText)}>
          <Text variant="ui" tone="strong">
            {runner.name}
          </Text>
          <Text variant="meta" mono truncate>
            {runner.sshTarget}
          </Text>
        </span>
        <Button
          variant={primary ? "primary" : "secondary"}
          disabled={checking}
          onClick={() =>
            submit.run(() => actions.recheckRunner({ id: runner.id }), t("checkRequested"))
          }
        >
          {checking ? t("checking") : t("recheck")}
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
  const { ago } = useTime();
  if (check === null) return <Text variant="meta">{t("never")}</Text>;
  switch (check.status) {
    case "pending":
      return (
        <Text variant="ui" as="p" role="status">
          {workerSilent ? t("workerSilent") : t("pending")}
        </Text>
      );
    case "failed":
      return (
        <Text variant="ui" as="p" tone="problem">
          {t("failed", { error: check.error })}
        </Text>
      );
    case "unreadable":
      return (
        <Text variant="ui" as="p" tone="problem">
          {t("unreadable")}
        </Text>
      );
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
            <DividedList>
              {check.prerequisites.map((prerequisite) => (
                <Prerequisite key={prerequisite.id} prerequisite={prerequisite} />
              ))}
            </DividedList>
          )}
          <Text variant="meta">
            <time dateTime={check.completedAt}>
              {t("checkedAt", { time: ago(check.completedAt, check.completedAgoMs) })}
            </time>
          </Text>
        </div>
      );
  }
}

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
  const push =
    isPushCheck(prerequisite) && prerequisite.satisfied !== true
      ? summarizePushChecks([prerequisite])
      : null;
  return (
    <DividedItem tight>
      <span {...stylex.props(styles.inline)}>
        <Text variant="ui" tone="strong">
          {prerequisiteName(prerequisite)}
        </Text>
        {broken ? (
          <Text variant="ui" tone="problem">
            {t("unsatisfied")}
          </Text>
        ) : (
          <Text variant="meta">
            {prerequisite.satisfied === null ? t("unknown") : t("satisfied")}
          </Text>
        )}
      </span>
      {broken && hint !== null ? (
        <Text variant="meta" mono>
          {hint}
        </Text>
      ) : null}
      {push === null ? null : <PushProblems summary={push} />}
      {broken && prerequisite.blocksAssignment ? (
        <div {...stylex.props(styles.fix)}>
          <Text variant="ui" as="p" tone="problem">
            {t("blocked")}
          </Text>
          <Text variant="label">{t("fixTitle")}</Text>
          <ul {...stylex.props(textStyles("ui"), styles.bullets)}>
            <li>{t("fixToken")}</li>
            <li>{t("fixSsh")}</li>
          </ul>
        </div>
      ) : null}
    </DividedItem>
  );
}

function parseWholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

const styles = stylex.create({
  titleCell: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  form: { display: "flex", flexDirection: "column", gap: space.s4, maxWidth: size.formWidth },
  fieldRow: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(${size.fieldMinWidth}, 1fr))`,
    gap: space.s3,
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
    maxWidth: size.formWidth,
  },
  rowText: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  inline: { display: "inline-flex", alignItems: "center", gap: space.px6 },
  action: { flexShrink: 0 },
  fix: { display: "flex", flexDirection: "column", gap: space.s1 },
  snippet: { display: "flex", flexDirection: "column", gap: space.s3 },
  bullets: {
    margin: 0,
    paddingInlineStart: space.s5,
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
  },
});

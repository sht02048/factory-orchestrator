import * as stylex from "@stylexjs/stylex";
import {
  Button,
  Field,
  InfoTip,
  Input,
  PageHeader,
  ScreenLayout,
  SectionNav,
  SettingsGroup,
  SettingsLayout,
  SettingsLinkRow,
  SettingsRow,
  SettingsSection,
  Switch,
  Text,
  focusStyles,
  linkStyles,
  type SectionNavItem,
  type SettingsLinkRowRenderProps,
} from "@ganger/ui";
import { size, space } from "@ganger/ui/tokens.stylex";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { MAX_RUN_MINUTES } from "@ganger/app/settings/model";
import type {
  AddressesView,
  BoundProject,
  ConnectionProjects,
  PowerView,
  SettingsPage,
  TrackerConnectionView,
  TrackerProjectChoice,
  WorkspaceSettings,
} from "@ganger/app/settings/model";
import { useAgentName } from "../labels";
import { GITHUB_TOKEN_URL, LINEAR_API_KEY_URL } from "../onboarding/model";
import {
  useCredentialReason,
  CredentialFormFrame,
  ExternalLink,
  GitHubTokenForm,
  TrackerKeyForm,
} from "./credential-forms";
import {
  AutoSaveStatusText,
  EditorProvider,
  RevertedMessage,
  useAutoSave,
  useFocusFirstField,
  useInlineEdit,
  type InlineEdit,
} from "./row-state";
import {
  SubmitError,
  passwordManagerIgnoredSecretProps,
  useReason,
  useReportUnsaved,
  useSubmit,
  type SettingsActions,
} from "./settings-screen";
import type { UnsavedGuard } from "./navigation-guard";
import { UpdatesRows } from "./updates-panel";

export const SETTINGS_SECTIONS = [
  "workspace",
  "projects",
  "connections",
  "server",
  "advanced",
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

export type SettingsLinkTarget =
  | { kind: "project"; connectionId: string; projectId: string }
  | { kind: "runners" }
  | { kind: "mcp" }
  | { kind: "settings" }
  | { kind: "createWorkspace" };

export type RenderSettingsLink = (
  target: SettingsLinkTarget,
  props: SettingsLinkRowRenderProps,
) => ReactNode;

export type WorkspaceView = "one" | "none" | "all";

export function settingsHref(target: SettingsLinkTarget, ws: string | undefined): string {
  const search = ws === undefined ? "" : `?${new URLSearchParams({ ws }).toString()}`;
  switch (target.kind) {
    case "project":
      return `/settings/projects/${encodeURIComponent(target.connectionId)}/${encodeURIComponent(target.projectId)}${search}`;
    case "runners":
      return `/runners${search}`;
    case "mcp":
      return `/settings/mcp${search}`;
    case "settings":
      return `/settings${search}`;
    case "createWorkspace":
      return "/onboarding?step=4";
  }
}

export function plainSettingsLink(ws: string | undefined): RenderSettingsLink {
  return (target, props) => <a href={settingsHref(target, ws)} {...props} />;
}

export function projectRowId(connectionId: string, projectId: string): string {
  return `project-${connectionId}-${projectId}`;
}

export interface SettingsScreenProps {
  page: SettingsPage;
  runnerIssues: number;
  workspaceView: WorkspaceView;
  ws: string | undefined;
  actions: SettingsActions;
  renderLink?: RenderSettingsLink;
  renderGuard?: (guard: UnsavedGuard) => ReactNode;
}

export function SettingsScreen({
  page,
  runnerIssues,
  workspaceView,
  ws,
  actions,
  renderLink = plainSettingsLink(ws),
  renderGuard,
}: SettingsScreenProps) {
  const t = useTranslations("settings");
  const workspace = page.workspace;
  const problems = sectionProblems(page, runnerIssues);
  const navItems: SectionNavItem[] = SETTINGS_SECTIONS.filter(
    (id) => workspace !== null || id !== "projects",
  ).map((id) => ({
    id,
    label: t(`sections.${id}`),
    problem: problems.has(id),
  }));
  return (
    <ScreenLayout header={<PageHeader title={t("title")} />}>
      <EditorProvider {...(renderGuard === undefined ? {} : { renderGuard })}>
        <SettingsLayout
          nav={
            <SectionNav label={t("nav.label")} items={navItems} problemLabel={t("nav.problem")} />
          }
        >
          <SettingsSection id="workspace" title={t("sections.workspace")}>
            {workspace === null ? (
              <NoWorkspace view={workspaceView} renderLink={renderLink} />
            ) : (
              <WorkspaceRows workspace={workspace} actions={actions} />
            )}
          </SettingsSection>
          {workspace === null ? null : (
            <ProjectsSection
              page={page}
              workspace={workspace}
              actions={actions}
              renderLink={renderLink}
            />
          )}
          <ConnectionsSection
            page={page}
            runnerIssues={runnerIssues}
            actions={actions}
            renderLink={renderLink}
          />
          <SettingsSection id="server" title={t("sections.server")}>
            <SettingsGroup>
              <AddressRow field="webAddress" addresses={page.install.addresses} actions={actions} />
              <PowerRow power={page.install.power} actions={actions} />
              <UpdatesRows />
            </SettingsGroup>
          </SettingsSection>
          <SettingsSection id="advanced" title={t("sections.advanced")}>
            <SettingsGroup>
              <AddressRow
                field="webhookAddress"
                addresses={page.install.addresses}
                actions={actions}
              />
              <SettingsLinkRow
                label={t("mcp.title")}
                detail={page.install.mcp.writeAllowed ? t("mcp.rowWrite") : t("mcp.rowRead")}
                render={(props) => renderLink({ kind: "mcp" }, props)}
              />
            </SettingsGroup>
          </SettingsSection>
        </SettingsLayout>
      </EditorProvider>
    </ScreenLayout>
  );
}

export function sectionProblems(
  page: SettingsPage,
  runnerIssues: number,
): ReadonlySet<SettingsSectionId> {
  const problems = new Set<SettingsSectionId>();
  const workspace = page.workspace;
  if (
    workspace !== null &&
    (workspace.bound.length === 0 ||
      workspace.bound.some((b) => b.mapping === null) ||
      workspace.trackerProjects.some((group) => group.error !== null))
  ) {
    problems.add("projects");
  }
  const install = page.install;
  if (
    install.connections.length === 0 ||
    !install.githubToken ||
    install.runners.length === 0 ||
    runnerIssues > 0
  ) {
    problems.add("connections");
  }
  return problems;
}

function NoWorkspace({
  view,
  renderLink,
}: {
  view: WorkspaceView;
  renderLink: RenderSettingsLink;
}) {
  const t = useTranslations("settings.workspace");
  return (
    <SettingsGroup>
      <SettingsRow
        label={view === "all" ? t("all") : t("none")}
        control={
          view === "all"
            ? undefined
            : renderLink(
                { kind: "createWorkspace" },
                { ...stylex.props(linkStyles("action")), children: t("create") },
              )
        }
      />
    </SettingsGroup>
  );
}

function ChangeButton({
  edit,
  label,
  action,
}: {
  edit: InlineEdit;
  label: string;
  action?: string;
}) {
  const t = useTranslations("settings");
  const text = action ?? t("change");
  return (
    <Button
      ref={edit.triggerRef}
      aria-label={t("changeLabel", { label, action: text })}
      aria-expanded={false}
      onClick={edit.show}
    >
      {text}
    </Button>
  );
}

function WorkspaceRows({
  workspace,
  actions,
}: {
  workspace: WorkspaceSettings;
  actions: SettingsActions;
}) {
  return (
    <SettingsGroup>
      <WorkspaceNameRow workspace={workspace} actions={actions} />
      <MaxRunRow workspace={workspace} actions={actions} />
    </SettingsGroup>
  );
}

function WorkspaceNameRow({
  workspace,
  actions,
}: {
  workspace: WorkspaceSettings;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const edit = useInlineEdit("workspace-name");
  const labelId = useId();
  const { general } = workspace;
  return (
    <SettingsRow
      label={t("workspace.name")}
      labelId={labelId}
      value={edit.open ? undefined : general.name}
      control={edit.open ? undefined : <ChangeButton edit={edit} label={t("workspace.name")} />}
      formOnly
      expanded={
        edit.open ? (
          <TextEditor
            label={t("workspace.name")}
            initial={general.name}
            validate={(value) => (value.trim() === "" ? t("workspace.nameInvalid") : null)}
            save={(value) =>
              actions.saveGeneral({
                ws: general.id,
                name: value.trim(),
                maxRunMinutes: general.maxRunMinutes,
              })
            }
            saved={t("workspace.nameSaved")}
            onClose={edit.close}
          />
        ) : null
      }
    />
  );
}

function TextEditor({
  label,
  initial,
  validate,
  save,
  saved,
  onClose,
  mono = false,
  type = "text",
  placeholder,
}: {
  label: string;
  initial: string;
  validate: (value: string) => string | null;
  save: (value: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  saved: string;
  onClose: () => void;
  mono?: boolean;
  type?: "text" | "url";
  placeholder?: string;
}) {
  const t = useTranslations("settings");
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useReportUnsaved(value !== initial);
  const submit = useSubmit();
  const focusRef = useFocusFirstField();
  return (
    <div ref={focusRef} tabIndex={-1} {...stylex.props(focusStyles.target)}>
      <CredentialFormFrame
        onClose={onClose}
        footer={null}
        onSubmit={() => {
          const problem = validate(value);
          setInvalid(problem);
          if (problem !== null) {
            inputRef.current?.focus();
            return;
          }
          submit.run(() => save(value), saved, onClose);
        }}
        submit={
          <Button variant="primary" type="submit" disabled={submit.sending}>
            {submit.sending ? t("saving") : t("save")}
          </Button>
        }
      >
        <Field label={label} error={invalid ?? undefined}>
          <Input
            ref={inputRef}
            name="value"
            type={type}
            value={value}
            onValueChange={(next) => {
              setValue(next);
              if (invalid !== null) setInvalid(validate(next));
            }}
            autoComplete="off"
            mono={mono}
            {...(placeholder === undefined ? {} : { placeholder })}
          />
        </Field>
        <SubmitError state={submit.state} />
      </CredentialFormFrame>
    </div>
  );
}

function parseMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const minutes = Number(trimmed);
  return minutes >= 1 && minutes <= MAX_RUN_MINUTES ? minutes : null;
}

function MaxRunRow({
  workspace,
  actions,
}: {
  workspace: WorkspaceSettings;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const { general } = workspace;
  const autoSave = useAutoSave(general.maxRunMinutes, (minutes: number) =>
    actions.saveGeneral({ ws: general.id, name: general.name, maxRunMinutes: minutes }),
  );
  const [draft, setDraft] = useState(String(autoSave.value));
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const maxRunErrorId = useId();
  useEffect(() => {
    if (!editing) setDraft(String(autoSave.value));
  }, [autoSave.value, editing]);
  const commit = () => {
    const minutes = parseMinutes(draft);
    if (minutes === null) {
      setInvalid(true);
      return;
    }
    setEditing(false);
    setInvalid(false);
    if (minutes !== autoSave.value) autoSave.change(minutes);
    else setDraft(String(minutes));
  };
  return (
    <SettingsRow
      label={t("workspace.maxRun")}
      info={
        <InfoTip
          label={t("infoLabel", { label: t("workspace.maxRun") })}
          content={t("workspace.maxRunInfo")}
        />
      }
      status={<AutoSaveStatusText status={autoSave.status} />}
      control={
        <form
          {...stylex.props(styles.number)}
          onSubmit={(event) => {
            event.preventDefault();
            commit();
          }}
          onBlur={() => {
            if (editing) commit();
          }}
        >
          <span {...stylex.props(styles.numberInput)}>
            <Input
              name="maxRunMinutes"
              aria-label={t("workspace.maxRunLabel")}
              {...(invalid ? { "aria-describedby": maxRunErrorId } : {})}
              value={draft}
              onValueChange={(value) => {
                setEditing(true);
                setDraft(value);
                if (invalid) setInvalid(parseMinutes(value) === null);
              }}
              inputMode="numeric"
              autoComplete="off"
              mono
              invalid={invalid}
            />
          </span>
          <Text variant="meta">{t("workspace.maxRunUnit")}</Text>
        </form>
      }
      message={
        invalid ? (
          <Text variant="meta" as="p" tone="problem" role="alert" id={maxRunErrorId}>
            {t("workspace.maxRunInvalid")}
          </Text>
        ) : (
          <RevertedMessage error={autoSave.error} />
        )
      }
    />
  );
}

function ProjectsSection({
  page,
  workspace,
  actions,
  renderLink,
}: {
  page: SettingsPage;
  workspace: WorkspaceSettings;
  actions: SettingsActions;
  renderLink: RenderSettingsLink;
}) {
  const t = useTranslations("settings");
  const edit = useInlineEdit("projects-add");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  useEffect(() => {
    if (focusKey === null) return;
    const link = document.getElementById(focusKey)?.querySelector<HTMLElement>("a");
    if (link === null || link === undefined) return;
    link.focus();
    setFocusKey(null);
  }, [focusKey, workspace]);
  const hasConnections = workspace.trackerProjects.length > 0;
  return (
    <SettingsSection
      id="projects"
      title={t("sections.projects")}
      actions={
        hasConnections && !edit.open ? (
          <Button
            ref={edit.triggerRef}
            aria-label={t("projects.openLabel")}
            aria-expanded={false}
            onClick={edit.show}
          >
            {t("projects.open")}
          </Button>
        ) : undefined
      }
    >
      <SettingsGroup>
        {workspace.bound.map((bound) => (
          <ProjectLinkRow
            key={`${bound.connection.id}/${bound.project.id}`}
            bound={bound}
            page={page}
            workspace={workspace}
            renderLink={renderLink}
          />
        ))}
        {workspace.bound.length === 0 && !edit.open ? (
          <SettingsRow
            label={hasConnections ? t("projects.none") : t("projects.needConnection")}
            control={
              hasConnections ? undefined : (
                <a href="#connections" {...stylex.props(linkStyles("action"))}>
                  {t("projects.toConnections")}
                </a>
              )
            }
          />
        ) : null}
        {edit.open ? (
          <SettingsRow
            label={t("projects.candidates")}
            info={
              <InfoTip
                label={t("infoLabel", { label: t("projects.candidates") })}
                content={t("projects.info")}
              />
            }
            expanded={
              <FocusFirst onEscape={edit.close}>
                <ProjectCandidates
                  workspace={workspace}
                  actions={actions}
                  onAdded={(connectionId, projectId) => {
                    edit.close();
                    setFocusKey(projectRowId(connectionId, projectId));
                  }}
                />
                <span {...stylex.props(styles.candidateClose)}>
                  <Button variant="ghost" onClick={edit.close}>
                    {t("close")}
                  </Button>
                </span>
              </FocusFirst>
            }
          />
        ) : null}
      </SettingsGroup>
    </SettingsSection>
  );
}

function ProjectLinkRow({
  bound,
  page,
  workspace,
  renderLink,
}: {
  bound: BoundProject;
  page: SettingsPage;
  workspace: WorkspaceSettings;
  renderLink: RenderSettingsLink;
}) {
  const t = useTranslations("settings.projects");
  const agentName = useAgentName();
  const mapping = bound.mapping;
  const repo = mapping === null ? null : repoSummary(mapping.repos, page, t);
  const label = autoLabelName(workspace, bound.connection.id);
  const prefix = workspace.trackerProjects.length > 1 ? `${bound.connection.name} · ` : "";
  return (
    <SettingsLinkRow
      id={projectRowId(bound.connection.id, bound.project.id)}
      label={bound.project.name}
      detail={
        mapping === null || repo === null
          ? `${prefix}${t("noRepo")}`
          : `${prefix}${t("repoAgent", { repo, agent: agentName(mapping.agent) })}`
      }
      detailTone={mapping === null ? "problem" : "default"}
      value={
        mapping === null ? t("decide") : label === null ? undefined : t("autoLabel", { label })
      }
      render={(props) =>
        renderLink(
          { kind: "project", connectionId: bound.connection.id, projectId: bound.project.id },
          props,
        )
      }
    />
  );
}

function repoSummary(
  repos: ReadonlyArray<{ id: string; isDefault: boolean }>,
  page: SettingsPage,
  t: ReturnType<typeof useTranslations<"settings.projects">>,
): string | null {
  const main = repos.find((r) => r.isDefault) ?? repos[0];
  if (main === undefined) return null;
  const name = page.runnerProjects.find((p) => p.id === main.id)?.name ?? main.id;
  return repos.length > 1 ? t("repoMore", { repo: name, count: repos.length - 1 }) : name;
}

export function autoLabelName(workspace: WorkspaceSettings, connectionId: string): string | null {
  const entry = workspace.labels.find((l) => l.connection.id === connectionId);
  if (entry === undefined || entry.labelId === null) return null;
  const id = entry.labelId;
  return entry.labels.ok ? (entry.labels.items.find((l) => l.id === id)?.name ?? id) : id;
}

export function ProjectCandidates({
  workspace,
  actions,
  onAdded,
}: {
  workspace: WorkspaceSettings;
  actions: SettingsActions;
  onAdded: (connectionId: string, projectId: string) => void;
}) {
  const t = useTranslations("settings.projects");
  const reason = useReason();
  const groups = workspace.trackerProjects;
  const candidates = groups.flatMap((group) =>
    group.projects
      .filter((project) => project.owner.kind !== "this")
      .map((project) => ({ group, project })),
  );
  return (
    <div {...stylex.props(styles.candidates)}>
      {groups.map((group) =>
        group.error === null ? null : (
          <Text key={group.connection.id} variant="meta" as="p" tone="problem">
            {t("listFailed", { reason: reason(group.error) })}
          </Text>
        ),
      )}
      {candidates.length === 0 ? (
        <Text variant="meta" as="p">
          {t("noCandidates")}
        </Text>
      ) : (
        <ul {...stylex.props(styles.candidateList)}>
          {candidates.map(({ group, project }) => (
            <CandidateItem
              key={`${group.connection.id}/${project.id}`}
              ws={workspace.general.id}
              group={group}
              project={project}
              showConnection={groups.length > 1}
              actions={actions}
              onAdded={onAdded}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CandidateItem({
  ws,
  group,
  project,
  showConnection,
  actions,
  onAdded,
}: {
  ws: string;
  group: ConnectionProjects;
  project: TrackerProjectChoice;
  showConnection: boolean;
  actions: SettingsActions;
  onAdded: (connectionId: string, projectId: string) => void;
}) {
  const t = useTranslations("settings.projects");
  const submit = useSubmit();
  const nameId = useId();
  const owner = project.owner;
  const meta =
    owner.kind === "other"
      ? t("inOther", { workspace: owner.workspace.name })
      : showConnection
        ? group.connection.name
        : null;
  return (
    <li {...stylex.props(styles.candidate)}>
      <span {...stylex.props(styles.candidateText)}>
        <Text variant="ui" tone={owner.kind === "other" ? "disabled" : "strong"} id={nameId}>
          {project.name}
        </Text>
        {meta === null ? null : <Text variant="meta">{meta}</Text>}
        <SubmitError state={submit.state} />
      </span>
      <Button
        aria-describedby={nameId}
        disabled={owner.kind === "other" || submit.sending}
        onClick={() =>
          submit.run(
            () =>
              actions.addProject({
                ws,
                connectionId: group.connection.id,
                projectId: project.id,
                name: project.name,
              }),
            t("added", { project: project.name }),
            () => onAdded(group.connection.id, project.id),
          )
        }
      >
        {t("add")}
      </Button>
    </li>
  );
}

function ConnectionsSection({
  page,
  runnerIssues,
  actions,
  renderLink,
}: {
  page: SettingsPage;
  runnerIssues: number;
  actions: SettingsActions;
  renderLink: RenderSettingsLink;
}) {
  const t = useTranslations("settings");
  const add = useInlineEdit("connection-add");
  const { connections, runners } = page.install;
  const needCheck = runnerIssues;
  return (
    <SettingsSection
      id="connections"
      title={t("sections.connections")}
      actions={
        add.open ? undefined : (
          <Button
            ref={add.triggerRef}
            aria-label={t("connections.addLabel")}
            aria-expanded={false}
            onClick={add.show}
          >
            {t("connections.add")}
          </Button>
        )
      }
    >
      <SettingsGroup>
        {connections.length === 0 && !add.open ? (
          <SettingsRow label={t("connections.none")} />
        ) : null}
        {connections.map((connection) => (
          <ConnectionRow key={connection.id} connection={connection} actions={actions} />
        ))}
        {add.open ? (
          <SettingsRow
            label={t("connections.addLabel")}
            expanded={
              <FocusFirst>
                <TrackerKeyForm
                  connection={null}
                  actions={actions}
                  hints="info"
                  primary
                  onClose={add.close}
                  onDone={add.close}
                  footer={
                    <ExternalLink href={LINEAR_API_KEY_URL}>
                      {t("credentials.keyGuideLink")}
                    </ExternalLink>
                  }
                />
              </FocusFirst>
            }
          />
        ) : null}
        <GitHubRow saved={page.install.githubToken} actions={actions} />
        <SettingsLinkRow
          label={t("runnersRow.label")}
          detail={
            needCheck > 0
              ? t("runnersRow.problems", { total: runners.length, count: needCheck })
              : t("runnersRow.count", { count: runners.length })
          }
          detailTone={needCheck > 0 || runners.length === 0 ? "problem" : "default"}
          value={t("runnersRow.manage")}
          render={(props) => renderLink({ kind: "runners" }, props)}
        />
      </SettingsGroup>
    </SettingsSection>
  );
}

function FocusFirst({ children, onEscape }: { children: ReactNode; onEscape?: () => void }) {
  const ref = useFocusFirstField();
  return (
    <div
      ref={ref}
      tabIndex={-1}
      {...(onEscape === undefined
        ? {}
        : {
            onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              onEscape();
            },
          })}
      {...stylex.props(focusStyles.target)}
    >
      {children}
    </div>
  );
}

function ConnectionRow({
  connection,
  actions,
}: {
  connection: TrackerConnectionView;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const edit = useInlineEdit(`connection-${connection.id}`);
  const labelId = useId();
  return (
    <SettingsRow
      label={connection.name}
      labelId={labelId}
      detail={
        connection.hasWebhookSecret ? t("connections.webhookOn") : t("connections.webhookOff")
      }
      control={
        edit.open ? undefined : (
          <ChangeButton edit={edit} label={connection.name} action={t("connections.manage")} />
        )
      }
      expanded={
        edit.open ? (
          <FocusFirst>
            <ConnectionEditor connection={connection} actions={actions} onClose={edit.close} />
          </FocusFirst>
        ) : null
      }
    />
  );
}

function ConnectionEditor({
  connection,
  actions,
  onClose,
}: {
  connection: TrackerConnectionView;
  actions: SettingsActions;
  onClose: () => void;
}) {
  const t = useTranslations("settings");
  const describeTracker = useCredentialReason("tracker");
  const [name, setName] = useState(connection.name);
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  useReportUnsaved(name.trim() !== connection.name || apiKey !== "" || webhookSecret !== "");
  const submit = useSubmit();
  const check = useSubmit();
  const ready = name.trim() !== "";
  const [nameMissing, setNameMissing] = useState(false);
  return (
    <CredentialFormFrame
      onClose={onClose}
      onSubmit={() => {
        setNameMissing(!ready);
        if (!ready) return;
        submit.run(
          () =>
            actions.saveConnection({
              id: connection.id,
              name: name.trim(),
              apiKey: apiKey.trim(),
              webhookSecret: webhookSecret.trim(),
            }),
          t("saved"),
          onClose,
        );
      }}
      footer={
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
      }
      submit={
        <Button variant="primary" type="submit" disabled={submit.sending}>
          {submit.sending ? t("saving") : t("save")}
        </Button>
      }
    >
      <SubmitError state={check.state} describe={describeTracker} />
      <Field
        label={t("connections.name")}
        error={nameMissing ? t("connections.nameRequired") : undefined}
      >
        <Input
          name="name"
          value={name}
          onValueChange={(value) => {
            setName(value);
            if (nameMissing) setNameMissing(value.trim() === "");
          }}
          placeholder={t("connections.namePlaceholder")}
          autoComplete="off"
        />
      </Field>
      <Field
        label={t("connections.apiKey")}
        info={
          <InfoTip
            label={t("infoLabel", { label: t("connections.apiKey") })}
            content={t("connections.keepSecret")}
          />
        }
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
        info={
          <InfoTip
            label={t("infoLabel", { label: t("connections.webhookSecret") })}
            content={`${t("connections.webhookSecretInfo")} ${t("connections.keepSecret")}`}
          />
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
      <Field
        label={t("connections.webhookPath")}
        info={
          <InfoTip
            label={t("infoLabel", { label: t("connections.webhookPath") })}
            content={t("connections.webhookPathInfo")}
          />
        }
      >
        <Input value={connection.webhookPath} readOnly mono />
      </Field>
      <SubmitError state={submit.state} describe={describeTracker} />
    </CredentialFormFrame>
  );
}

function GitHubRow({ saved, actions }: { saved: boolean; actions: SettingsActions }) {
  const t = useTranslations("settings");
  const edit = useInlineEdit("github");
  const labelId = useId();
  const describeGitHub = useCredentialReason("github");
  const check = useSubmit();
  return (
    <SettingsRow
      label={t("github.label")}
      labelId={labelId}
      detail={saved ? t("github.set") : t("github.unset")}
      detailTone={saved ? "default" : "problem"}
      control={
        edit.open ? undefined : (
          <ChangeButton
            edit={edit}
            label={t("github.label")}
            action={saved ? t("change") : t("github.enter")}
          />
        )
      }
      message={
        edit.open ? undefined : <SubmitError state={check.state} describe={describeGitHub} />
      }
      expanded={
        edit.open ? (
          <FocusFirst>
            <GitHubTokenForm
              actions={actions}
              hints="info"
              primary
              onClose={edit.close}
              onDone={edit.close}
              footer={
                <>
                  <ExternalLink href={GITHUB_TOKEN_URL}>{t("github.guideLink")}</ExternalLink>
                  <InfoTip label={t("github.permissionsLabel")} content={t("github.permissions")} />
                  {saved ? (
                    <Button
                      variant="ghost"
                      disabled={check.sending}
                      onClick={() =>
                        check.run(() => actions.checkGitHubToken(), t("github.checkOk"))
                      }
                    >
                      {check.sending ? t("github.checking") : t("github.check")}
                    </Button>
                  ) : null}
                </>
              }
            />
            <SubmitError state={check.state} describe={describeGitHub} />
          </FocusFirst>
        ) : null
      }
    />
  );
}

function AddressRow({
  field,
  addresses,
  actions,
}: {
  field: "webAddress" | "webhookAddress";
  addresses: AddressesView;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const edit = useInlineEdit(`address-${field}`);
  const labelId = useId();
  const current = addresses[field];
  const label = field === "webAddress" ? t("addresses.web") : t("addresses.webhook");
  return (
    <SettingsRow
      label={label}
      labelId={labelId}
      info={
        <InfoTip
          label={t("infoLabel", { label })}
          content={field === "webAddress" ? t("addresses.webInfo") : t("addresses.webhookInfo")}
        />
      }
      detail={
        current ?? (field === "webAddress" ? t("addresses.webNone") : t("addresses.webhookNone"))
      }
      detailMono={current !== null}
      control={
        edit.open ? undefined : (
          <ChangeButton
            edit={edit}
            label={label}
            action={current === null ? t("addresses.set") : t("change")}
          />
        )
      }
      formOnly
      expanded={
        edit.open ? (
          <TextEditor
            label={label}
            initial={current ?? ""}
            type="url"
            mono
            placeholder={
              field === "webAddress"
                ? t("addresses.webPlaceholder")
                : t("addresses.webhookPlaceholder")
            }
            validate={() => null}
            save={(value) =>
              actions.saveAddresses({
                webAddress: field === "webAddress" ? value.trim() : (addresses.webAddress ?? ""),
                webhookAddress:
                  field === "webhookAddress" ? value.trim() : (addresses.webhookAddress ?? ""),
              })
            }
            saved={t("saved")}
            onClose={edit.close}
          />
        ) : null
      }
    />
  );
}

function PowerRow({ power, actions }: { power: PowerView; actions: SettingsActions }) {
  const t = useTranslations("settings");
  const labelId = useId();
  const switchId = useId();
  const autoSave = useAutoSave(power.preventSleep, (preventSleep: boolean) =>
    actions.savePower({ preventSleep }),
  );
  return (
    <SettingsRow
      label={t("power.toggle")}
      labelId={labelId}
      labelFor={switchId}
      disabled={!power.available}
      info={
        <InfoTip label={t("infoLabel", { label: t("power.toggle") })} content={t("power.info")} />
      }
      detail={power.available ? t("power.detail") : t("power.unavailable")}
      status={<AutoSaveStatusText status={autoSave.status} />}
      control={
        <Switch
          id={switchId}
          aria-labelledby={labelId}
          checked={power.available && autoSave.value}
          disabled={!power.available}
          onCheckedChange={autoSave.change}
        />
      }
      message={<RevertedMessage error={autoSave.error} />}
    />
  );
}

const styles = stylex.create({
  number: { display: "flex", alignItems: "center", gap: space.s2 },
  numberInput: { display: "flex", width: size.settingsNumberWidth },
  candidates: { display: "flex", flexDirection: "column", gap: space.s2 },
  candidateClose: { display: "flex", justifyContent: "flex-end", paddingTop: space.s2 },
  candidateList: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  candidate: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
    paddingBlock: space.s1,
  },
  candidateText: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
});

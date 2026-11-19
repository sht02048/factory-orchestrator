import * as stylex from "@stylexjs/stylex";
import {
  ChevronRightIcon,
  Dialog,
  DialogClose,
  InfoTip,
  NoticeLayout,
  PageHeader,
  ScreenLayout,
  Select,
  SettingsGroup,
  SettingsLayout,
  SettingsRow,
  SettingsSection,
  Text,
  VisuallyHidden,
  linkStyles,
} from "@ganger/ui";
import { breakpoints, size, space } from "@ganger/ui/tokens.stylex";
import { useId } from "react";
import { useTranslations } from "use-intl";
import type {
  BoundProject,
  ConnectionLabel,
  SettingsPage,
  WorkspaceSettings,
} from "@ganger/app/settings/model";
import { AutoSaveStatusText, RevertedMessage, useAutoSave } from "./row-state";
import { AutoAssignLabelPicker } from "./label-picker";
import { MappingEditor, ReloadFromTracker, autoAssignLabelOf } from "./mapping-editor";
import {
  SubmitError,
  useReason,
  useSubmit,
  withCurrent,
  type SettingsActions,
} from "./settings-screen";
import { plainSettingsLink, type RenderSettingsLink } from "./settings-page";

export interface ProjectDetailScreenProps {
  page: SettingsPage;
  connectionId: string;
  projectId: string;
  ws: string | undefined;
  actions: SettingsActions;
  onRemoved: () => void;
  renderLink?: RenderSettingsLink;
}

export function findBoundProject(
  workspace: WorkspaceSettings | null,
  connectionId: string,
  projectId: string,
): BoundProject | null {
  return (
    workspace?.bound.find(
      (bound) => bound.connection.id === connectionId && bound.project.id === projectId,
    ) ?? null
  );
}

export function ProjectDetailScreen({
  page,
  connectionId,
  projectId,
  ws,
  actions,
  onRemoved,
  renderLink = plainSettingsLink(ws),
}: ProjectDetailScreenProps) {
  const t = useTranslations("settings.project");
  const ts = useTranslations("settings");
  const tm = useTranslations("settings.mapping");
  const workspace = page.workspace;
  const bound = findBoundProject(workspace, connectionId, projectId);
  const back = renderLink(
    { kind: "settings" },
    {
      ...stylex.props(linkStyles("quiet"), styles.crumb),
      children: (
        <>
          {t("breadcrumb")}
          <ChevronRightIcon />
        </>
      ),
    },
  );
  if (workspace === null || bound === null) {
    return (
      <ScreenLayout header={<PageHeader lead={back} title={t("breadcrumb")} />}>
        <NoticeLayout>
          <Text variant="body">{t("notFound")}</Text>
          {renderLink(
            { kind: "settings" },
            { ...stylex.props(linkStyles("action")), children: t("back") },
          )}
        </NoticeLayout>
      </ScreenLayout>
    );
  }
  const label = workspace.labels.find((l) => l.connection.id === connectionId) ?? null;
  return (
    <ScreenLayout
      header={
        <PageHeader
          lead={back}
          title={bound.project.name}
          subtitle={bound.connection.name}
          actions={<ReloadFromTracker onReload={actions.reloadFromTracker} />}
        />
      }
    >
      <SettingsLayout>
        <MappingEditor
          ws={workspace.general.id}
          bound={bound}
          runnerProjects={page.runnerProjects}
          agents={page.agents}
          actions={actions}
          autoAssignLabelId={autoAssignLabelOf(workspace, bound.connection.id)}
          heading={<VisuallyHidden>{bound.project.name}</VisuallyHidden>}
          renderSections={({ repos, agent }) => (
            <>
              <SettingsSection
                id="repo"
                title={t("repo")}
                info={
                  <InfoTip
                    label={ts("infoLabel", { label: t("repo") })}
                    content={`${tm("routeHint")} ${t("repoInfo")}`}
                  />
                }
              >
                <SettingsGroup>
                  <div {...stylex.props(styles.mapping)}>{repos}</div>
                </SettingsGroup>
              </SettingsSection>
              <SettingsSection id="agent" title={tm("agent")}>
                {agent}
              </SettingsSection>
            </>
          )}
        />
        <SettingsSection id="assign" title={t("assign")}>
          <SettingsGroup>
            {label === null ? null : (
              <LabelRow ws={workspace.general.id} label={label} actions={actions} />
            )}
            <StateRow ws={workspace.general.id} bound={bound} actions={actions} />
          </SettingsGroup>
        </SettingsSection>
        <SettingsGroup>
          <RemoveRow
            ws={workspace.general.id}
            bound={bound}
            workspace={workspace}
            actions={actions}
            onRemoved={onRemoved}
          />
        </SettingsGroup>
      </SettingsLayout>
    </ScreenLayout>
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
  return (
    <SettingsRow
      label={t("project.label")}
      detail={t("project.labelScope", { connection: label.connection.name })}
      message={
        <AutoAssignLabelPicker
          ws={ws}
          label={label}
          actions={actions}
          selectLabel={t("label.selectFor", { connection: label.connection.name })}
          showReload={false}
        />
      }
    />
  );
}

function StateRow({
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
  const autoSave = useAutoSave(bound.inProgressStateId, (stateId: string | null) =>
    stateId === null
      ? Promise.resolve({ ok: true as const })
      : actions.saveInProgress({
          ws,
          connectionId: bound.connection.id,
          projectId: bound.project.id,
          stateId,
        }),
  );
  const options = withCurrent(
    bound.states.ok ? bound.states.items.map((s) => ({ value: s.id, label: s.name })) : [],
    bound.inProgressStateId,
  );
  return (
    <SettingsRow
      label={t("project.state")}
      info={
        <InfoTip
          label={t("infoLabel", { label: t("project.state") })}
          content={t("project.stateInfo")}
        />
      }
      status={<AutoSaveStatusText status={autoSave.status} />}
      wideControl
      control={
        <span {...stylex.props(styles.select)}>
          <Select
            aria-label={t("project.state")}
            options={options}
            value={autoSave.value}
            onValueChange={autoSave.change}
            placeholder={t("project.stateChoose")}
          />
        </span>
      }
      message={
        bound.states.ok ? (
          <RevertedMessage error={autoSave.error} />
        ) : (
          <Text variant="meta" as="p" tone="problem">
            {t("project.statesFailed", { reason: reason(bound.states.error) })}
          </Text>
        )
      }
    />
  );
}

function RemoveRow({
  ws,
  bound,
  workspace,
  actions,
  onRemoved,
}: {
  ws: string;
  bound: BoundProject;
  workspace: WorkspaceSettings;
  actions: SettingsActions;
  onRemoved: () => void;
}) {
  const t = useTranslations("settings");
  const submit = useSubmit();
  const labelId = useId();
  const choice = workspace.trackerProjects
    .find((group) => group.connection.id === bound.connection.id)
    ?.projects.find((project) => project.id === bound.project.id);
  const mappings = choice?.mappings ?? (bound.mapping === null ? 0 : 1);
  const queued = choice?.queuedRuns ?? 0;
  return (
    <SettingsRow
      label={t("project.remove")}
      labelId={labelId}
      detail={t("project.removeDetail")}
      message={<SubmitError state={submit.state} />}
      control={
        <Dialog
          trigger={
            <>
              <VisuallyHidden>
                {t("project.removeTrigger", { project: bound.project.name })}
              </VisuallyHidden>
              <span aria-hidden="true">{t("projects.remove")}</span>
            </>
          }
          triggerVariant="danger"
          title={t("projects.removeTitle", { project: bound.project.name })}
          description={
            <>
              {t("projects.removeBody", { mappings })}
              {queued === 0 ? null : <> {t("projects.removeQueued", { count: queued })}</>}
            </>
          }
          actions={
            <>
              <DialogClose>{t("projects.cancel")}</DialogClose>
              <DialogClose
                variant="danger"
                onClick={() =>
                  submit.run(
                    () =>
                      actions.removeProject({
                        ws,
                        connectionId: bound.connection.id,
                        projectId: bound.project.id,
                      }),
                    t("projects.removed", { project: bound.project.name }),
                    onRemoved,
                  )
                }
              >
                {t("projects.remove")}
              </DialogClose>
            </>
          }
        />
      }
    />
  );
}

const styles = stylex.create({
  mapping: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    paddingBlock: space.s4,
    paddingInline: { default: space.s5, [breakpoints.settingsRowStacked]: space.s4 },
  },
  crumb: { display: "inline-flex", alignItems: "center", gap: space.s1 },
  select: {
    display: "flex",
    width: { default: size.settingsControlWidth, [breakpoints.settingsRowStacked]: "100%" },
    minWidth: 0,
  },
});

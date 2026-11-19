import * as stylex from "@stylexjs/stylex";
import {
  Card,
  ChevronRightIcon,
  Dialog,
  DialogClose,
  DividedList,
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
  linkStyles,
} from "@ganger/ui";
import { size, space } from "@ganger/ui/tokens.stylex";
import { useId } from "react";
import { useTranslations } from "use-intl";
import type {
  BoundProject,
  ConnectionLabel,
  SettingsPage,
  WorkspaceSettings,
} from "@ganger/app/settings/model";
import { AutoSaveStatusText, RevertedMessage, useAutoSave } from "./row-state";
import {
  MappingRow,
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
        <PageHeader lead={back} title={bound.project.name} subtitle={bound.connection.name} />
      }
    >
      <SettingsLayout>
        <SettingsSection
          id="repo"
          title={t("repo")}
          info={<InfoTip label={t("repo")} content={t("repoInfo")} />}
        >
          <Card>
            <DividedList>
              <MappingRow
                ws={workspace.general.id}
                bound={bound}
                runnerProjects={page.runnerProjects}
                agents={page.agents}
                actions={actions}
              />
            </DividedList>
          </Card>
        </SettingsSection>
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
  const t = useTranslations("settings.project");
  const reason = useReason();
  const autoSave = useAutoSave(label.labelId, (labelId: string | null) =>
    labelId === null
      ? Promise.resolve({ ok: true as const })
      : actions.saveLabel({ ws, connectionId: label.connection.id, labelId }),
  );
  const options = label.labels.ok
    ? label.labels.items.map((l) => ({ value: l.id, label: l.name }))
    : [];
  const current = label.labelId;
  const allOptions =
    current === null || options.some((o) => o.value === current)
      ? options
      : [...options, { value: current, label: t("labelUnknown", { id: current }) }];
  return (
    <SettingsRow
      label={t("label")}
      detail={t("labelScope", { connection: label.connection.name })}
      status={<AutoSaveStatusText status={autoSave.status} />}
      control={
        <span {...stylex.props(styles.select)}>
          <Select
            aria-label={t("label")}
            options={allOptions}
            value={autoSave.value}
            onValueChange={autoSave.change}
            placeholder={t("labelChoose")}
          />
        </span>
      }
      message={
        label.labels.ok ? (
          <RevertedMessage error={autoSave.error} />
        ) : (
          <Text variant="meta" as="p" tone="problem">
            {t("labelsFailed", { reason: reason(label.labels.error) })}
          </Text>
        )
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
          trigger={t("projects.remove")}
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
  crumb: { display: "inline-flex", alignItems: "center", gap: space.s1 },
  select: { display: "flex", width: size.settingsControlWidth, minWidth: 0 },
});

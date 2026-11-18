import * as stylex from "@stylexjs/stylex";
import {
  DefinitionItem,
  DefinitionList,
  DetailPanel,
  PageHeader,
  PanelBlock,
  PanelHeader,
  RowTitle,
  SplitView,
  StatusPill,
  Table,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableRows,
  Text,
} from "@factory/ui";
import { colors, fonts, space } from "@factory/ui/tokens.stylex";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { usePrerequisiteName } from "../labels";
import { useStatusName } from "../status";
import type { GitHubAuthCheck, RunWorkspace, RunnerView, RunnersPage } from "./model";

// 러너 | 상태 | 사용 중 | Queued | 남은 워크트리 | 마지막 확인
const columns = "minmax(0, 1fr) 112px 80px 72px 104px 96px";

export interface RunnersScreenProps {
  page: RunnersPage;
  /** 고른 러너. 없거나 목록에 없으면 첫 행을 고른다 */
  selectedId: string | undefined;
  onSelect: (runnerId: string) => void;
}

/** Runners: 러너 목록 + 오른쪽 상세 패널(ADR 0007, 시안 B). Workspace 와 상관없는 공용 화면이다(ADR 0006) */
export function RunnersScreen({ page, selectedId, onSelect }: RunnersScreenProps) {
  const t = useTranslations("runners");
  const { runners } = page;
  const selected = runners.find((r) => r.id === selectedId) ?? runners[0];
  const online = runners.filter((r) => r.online).length;

  return (
    <SplitView
      list={
        <>
          <PageHeader
            title={t("title")}
            subtitle={t("subtitle", { total: runners.length, online })}
          />
          <Table columns={columns}>
            <TableHead>
              <TableHeader>{t("columns.runner")}</TableHeader>
              <TableHeader>{t("columns.state")}</TableHeader>
              <TableHeader align="end">{t("columns.occupied")}</TableHeader>
              <TableHeader align="end">{t("columns.queued")}</TableHeader>
              <TableHeader align="end">{t("columns.leftWorktrees")}</TableHeader>
              <TableHeader align="end">{t("columns.checked")}</TableHeader>
            </TableHead>
            {runners.length === 0 ? (
              <TableEmpty>{t("noRunners")}</TableEmpty>
            ) : (
              <TableRows
                label={t("listLabel")}
                value={selected?.id ?? null}
                onValueChange={onSelect}
              >
                {runners.map((runner) => (
                  <RunnerRow key={runner.id} runner={runner} />
                ))}
              </TableRows>
            )}
          </Table>
        </>
      }
      panel={
        selected === undefined ? null : (
          <section aria-label={t("panel.label")}>
            <RunnerPanel runner={selected} />
          </section>
        )
      }
    />
  );
}

function RunnerRow({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners");
  const { ago } = useTime();
  const count = (n: number) => (n === 0 ? t("notApplicable") : t("count", { count: n }));
  return (
    <TableRow value={runner.id} label={runner.name}>
      <TableCell>
        <span {...stylex.props(styles.titleCell)}>
          <RowTitle>{runner.name}</RowTitle>
          {runner.sshTarget === null ? null : (
            <Text variant="meta" mono truncate>
              {runner.sshTarget}
            </Text>
          )}
        </span>
      </TableCell>
      <TableCell>
        <span {...stylex.props(styles.titleCell)}>
          <OnlineState online={runner.online} />
          {runner.assignmentBlocked ? (
            <Text variant="meta" truncate>
              {t("assignmentBlocked")}
            </Text>
          ) : null}
        </span>
      </TableCell>
      <TableCell align="end" numeric>
        {t("load", { occupied: runner.occupying.length, capacity: runner.capacity })}
      </TableCell>
      <TableCell align="end" numeric>
        {count(runner.queued.length)}
      </TableCell>
      <TableCell align="end" numeric>
        {count(runner.leftWorktrees.length)}
      </TableCell>
      <TableCell align="end" numeric>
        {runner.checked === null ? t("neverChecked") : ago(runner.checked.at, runner.checked.agoMs)}
      </TableCell>
    </TableRow>
  );
}

function OnlineState({ online }: { online: boolean }) {
  const statusName = useStatusName();
  const status = online ? "online" : "offline";
  return <StatusPill status={status}>{statusName(status)}</StatusPill>;
}

function RunnerPanel({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.panel");
  const domain = useTranslations("domain");
  const { duration, elapsed, ago } = useTime();
  const occupied = runner.occupying.length;
  const free = Math.max(0, runner.capacity - occupied);

  let reason: string;
  if (!runner.online) reason = t("reason.offline");
  else if (runner.assignmentBlocked) reason = t("reason.assignmentBlocked");
  else if (free === 0) reason = t("reason.full", { capacity: runner.capacity });
  else reason = t("reason.free", { capacity: runner.capacity, free });

  return (
    <DetailPanel>
      <PanelHeader
        status={
          <>
            <OnlineState online={runner.online} />
            <Text variant="meta">
              {runner.checked === null
                ? t("neverChecked")
                : t("checkedAgo", { time: ago(runner.checked.at, runner.checked.agoMs) })}
            </Text>
          </>
        }
        title={runner.name}
        {...(runner.sshTarget === null ? {} : { subtitle: runner.sshTarget })}
        reason={reason}
      />
      <PanelBlock title={t("capacity", { occupied, capacity: runner.capacity })}>
        <ol {...stylex.props(styles.list)}>
          {runner.occupying.map((run) => (
            <RunItem
              key={run.id}
              ticketKey={run.ticketKey}
              runId={run.id}
              workspace={run.workspace}
              meta={t("runMeta", {
                workspace: run.workspace.name,
                state: domain(`runState.${run.state}`),
                elapsed: elapsed(run.executionMs),
              })}
            />
          ))}
          {free === 0 ? null : (
            <li {...stylex.props(styles.item, styles.muted)}>
              {runner.online ? t("freeCapacity", { count: free }) : t("noFreeCapacity")}
            </li>
          )}
        </ol>
      </PanelBlock>
      {runner.queued.length === 0 ? null : (
        <PanelBlock title={t("queued", { count: runner.queued.length })}>
          <ol {...stylex.props(styles.list)}>
            {runner.queued.map((run) => (
              <RunItem
                key={run.id}
                ticketKey={run.ticketKey}
                runId={run.id}
                workspace={run.workspace}
                meta={t("queuedMeta", {
                  workspace: run.workspace.name,
                  duration: duration(run.waitMs),
                })}
              />
            ))}
          </ol>
        </PanelBlock>
      )}
      {runner.leftWorktrees.length === 0 ? null : (
        <PanelBlock title={t("leftWorktrees", { count: runner.leftWorktrees.length })}>
          <ul {...stylex.props(styles.list)}>
            {runner.leftWorktrees.map((run) => (
              <RunItem
                key={run.id}
                ticketKey={run.ticketKey}
                runId={run.id}
                workspace={run.workspace}
                meta={t("worktreeMeta", {
                  workspace: run.workspace.name,
                  reason: t(`worktree.${run.worktree}`),
                })}
              />
            ))}
          </ul>
        </PanelBlock>
      )}
      <GitHubAuthBlock runner={runner} />
      <PanelBlock title={t("projects", { count: runner.projects.length })}>
        {runner.projects.length === 0 ? (
          <Text variant="meta">{t("noProjects")}</Text>
        ) : (
          <ul {...stylex.props(styles.list)}>
            {runner.projects.map((project) => (
              <li key={project} {...stylex.props(styles.item, styles.secondary)}>
                {project}
              </li>
            ))}
          </ul>
        )}
      </PanelBlock>
      <DefinitionList>
        <DefinitionItem label={t("orcaPath")} empty={runner.orcaPath === null}>
          {runner.orcaPath === null ? (
            t("notConfigured")
          ) : (
            <Text variant="ui" mono>
              {runner.orcaPath}
            </Text>
          )}
        </DefinitionItem>
      </DefinitionList>
    </DetailPanel>
  );
}

/**
 * 러너 쪽 GitHub 인증(프로젝트마다 `git push --dry-run`, Q82.15). 깨졌으면 할당에서 빠졌다는 것과
 * 해결 방법을 보인다(Q82.14).
 */
function GitHubAuthBlock({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.panel.githubAuth");
  const checks = runner.githubAuth;
  return (
    <PanelBlock title={t("title")}>
      {checks === null ? (
        <Text variant="meta">{t("neverChecked")}</Text>
      ) : checks.length === 0 ? (
        <Text variant="meta">{t("noChecks")}</Text>
      ) : (
        <ul {...stylex.props(styles.list)}>
          {checks.map((check) => (
            <GitHubAuthItem key={check.id} check={check} />
          ))}
        </ul>
      )}
      {runner.assignmentBlocked ? (
        <p {...stylex.props(styles.guide)}>
          {t.rich("fix", {
            code: (chunks) => <code {...stylex.props(styles.code)}>{chunks}</code>,
          })}
        </p>
      ) : null}
    </PanelBlock>
  );
}

function GitHubAuthItem({ check }: { check: GitHubAuthCheck }) {
  const t = useTranslations("runners.panel.githubAuth");
  const prerequisiteName = usePrerequisiteName();
  const state = check.satisfied === null ? "unknown" : check.satisfied ? "ok" : "broken";
  return (
    <li {...stylex.props(styles.item, styles.authRow)}>
      <span {...stylex.props(styles.authName)}>{prerequisiteName(check)}</span>
      <Text variant="meta">{t(`state.${state}`)}</Text>
    </li>
  );
}

/** 런 한 줄. 티켓 키는 그 런의 Workspace 로 연 Runs 로 이어진다 */
function RunItem({
  ticketKey,
  runId,
  workspace,
  meta,
}: {
  ticketKey: string;
  runId: string;
  workspace: RunWorkspace;
  meta: ReactNode;
}) {
  return (
    <li {...stylex.props(styles.item, styles.run)}>
      <a href={runHref(workspace.id, runId)} {...stylex.props(styles.runLink)}>
        {ticketKey}
      </a>
      <Text variant="meta" numeric truncate>
        {meta}
      </Text>
    </li>
  );
}

function runHref(workspaceId: string, runId: string): string {
  return `/runs?${new URLSearchParams({ ws: workspaceId, sel: runId }).toString()}`;
}

const styles = stylex.create({
  titleCell: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  list: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" },
  item: {
    paddingBlock: space.s2,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  run: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  muted: { color: colors.textTertiary },
  secondary: { color: colors.textSecondary },
  authRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: space.s2,
    minWidth: 0,
  },
  authName: {
    color: colors.textPrimary,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  guide: { margin: 0, paddingTop: space.s2, color: colors.textSecondary },
  code: { fontFamily: fonts.mono },
  runLink: {
    color: colors.textPrimary,
    textDecoration: { default: "none", ":hover": "underline" },
    textUnderlineOffset: 3,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
});

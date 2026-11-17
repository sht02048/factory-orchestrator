import * as stylex from "@stylexjs/stylex";
import {
  DefinitionItem,
  DefinitionList,
  DetailPanel,
  Dot,
  PageHeader,
  PanelBlock,
  PanelHeader,
  RowTitle,
  SplitView,
  Table,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableRows,
  Text,
} from "@factory/ui";
import { colors, space } from "@factory/ui/tokens.stylex";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useFormatDuration } from "../format/duration";
import type { RunWorkspace, RunnerView, RunnersPage } from "./model";

// 러너 | 상태 | 사용 중 | Queued | 남은 워크트리 | 마지막 확인
const columns = "minmax(0, 1fr) 96px 80px 72px 104px 96px";

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
              <TableHeader align="end">{t("columns.waiting")}</TableHeader>
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
  const duration = useFormatDuration();
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
        <OnlineState online={runner.online} />
      </TableCell>
      <TableCell align="end" numeric>
        {t("load", { occupied: runner.occupying.length, capacity: runner.capacity })}
      </TableCell>
      <TableCell align="end" numeric>
        {count(runner.waiting.length)}
      </TableCell>
      <TableCell align="end" numeric>
        {count(runner.leftWorktrees.length)}
      </TableCell>
      <TableCell align="end" numeric>
        {runner.checkedAgoMs === null
          ? t("neverChecked")
          : t("checkedAgo", { duration: duration(runner.checkedAgoMs) })}
      </TableCell>
    </TableRow>
  );
}

function OnlineState({ online }: { online: boolean }) {
  const t = useTranslations("runners");
  return (
    <span {...stylex.props(styles.inline)}>
      <Dot tone={online ? "online" : "offline"} />
      {online ? t("online") : t("offline")}
    </span>
  );
}

function RunnerPanel({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.panel");
  const domain = useTranslations("domain");
  const duration = useFormatDuration();
  const occupied = runner.occupying.length;
  const free = Math.max(0, runner.capacity - occupied);

  let reason: string;
  if (!runner.online) reason = t("reason.offline");
  else if (free === 0) reason = t("reason.full", { capacity: runner.capacity });
  else reason = t("reason.free", { capacity: runner.capacity, free });

  return (
    <DetailPanel>
      <PanelHeader
        status={
          <>
            <OnlineState online={runner.online} />
            <Text variant="meta">
              {runner.checkedAgoMs === null
                ? t("neverChecked")
                : t("checkedAgo", { duration: duration(runner.checkedAgoMs) })}
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
                duration: duration(run.executionMs),
              })}
            />
          ))}
          {free === 0 ? null : (
            <li {...stylex.props(styles.item, styles.muted)}>
              {runner.online ? t("freeSlots", { count: free }) : t("noFreeSlots")}
            </li>
          )}
        </ol>
      </PanelBlock>
      {runner.waiting.length === 0 ? null : (
        <PanelBlock title={t("waiting", { count: runner.waiting.length })}>
          <ol {...stylex.props(styles.list)}>
            {runner.waiting.map((run) => (
              <RunItem
                key={run.id}
                ticketKey={run.ticketKey}
                runId={run.id}
                workspace={run.workspace}
                meta={t("waitingMeta", {
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
  inline: { display: "inline-flex", alignItems: "center", gap: space.px6 },
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
  runLink: {
    color: colors.textPrimary,
    textDecoration: { default: "none", ":hover": "underline" },
    textUnderlineOffset: 3,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
});

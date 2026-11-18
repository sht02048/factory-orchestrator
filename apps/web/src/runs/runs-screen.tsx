import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  DefinitionItem,
  DefinitionList,
  DetailPanel,
  PageHeader,
  PanelHeader,
  RowTitle,
  SplitView,
  StatusPill,
  Tab,
  Table,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableRows,
  Tabs,
  Text,
} from "@factory/ui";
import { colors, space } from "@factory/ui/tokens.stylex";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { useAgentName } from "../labels";
import { runStatus, useStatusName } from "../status";
import type { WorkspaceSummary } from "../shell/model";
import { RUN_FILTERS, elapsedMs, filterKeyOf, matchesFilter } from "./model";
import type { RunFilter, RunView, RunsPage } from "./model";

// 티켓 | 상태 | 에이전트 결과 | PR 상태 | 러너 | 에이전트 | 경과
const columns = "minmax(0, 1fr) 144px 128px 64px 96px 80px 72px";

/** 손댈 일(GLOSSARY): 개수를 밝게 보이는 필터 */
const attentionFilters: ReadonlySet<RunFilter> = new Set([
  "waiting-for-input",
  "disconnected",
  "human-check",
  "failed",
]);

export interface RunsScreenProps {
  page: RunsPage;
  /** "전체"에서 고를 Workspace 들 */
  workspaces: ReadonlyArray<WorkspaceSummary>;
  filter: RunFilter;
  /** 고른 런. 없거나 목록에 없으면 첫 행을 고른다 */
  selectedId: string | undefined;
  onFilterChange: (filter: RunFilter) => void;
  onSelect: (runId: string) => void;
  onPickWorkspace: (workspaceId: string) => void;
  /** 런의 Run 상세 주소 */
  runHref: (runId: string) => string;
}

/** Runs: 런 목록 + 오른쪽 상세 패널(ADR 0007, 시안 B) */
export function RunsScreen(props: RunsScreenProps) {
  const { page } = props;
  switch (page.workspace.kind) {
    case "none":
      return <Notice body={<NoWorkspace />} />;
    case "all":
      return (
        <Notice
          body={
            <AllWorkspaces workspaces={props.workspaces} onPickWorkspace={props.onPickWorkspace} />
          }
        />
      );
    case "one":
      return <RunsList {...props} workspaceName={page.workspace.workspace.name} />;
  }
}

function Notice({ body }: { body: ReactNode }) {
  const t = useTranslations("runs");
  return (
    <div {...stylex.props(styles.notice)}>
      <PageHeader title={t("title")} />
      {body}
    </div>
  );
}

function NoWorkspace() {
  const t = useTranslations("runs");
  return <Text variant="body">{t("noWorkspace")}</Text>;
}

function AllWorkspaces({
  workspaces,
  onPickWorkspace,
}: {
  workspaces: ReadonlyArray<WorkspaceSummary>;
  onPickWorkspace: (workspaceId: string) => void;
}) {
  const t = useTranslations("runs.allWorkspaces");
  return (
    <div {...stylex.props(styles.stack)}>
      <Text variant="body">{t("body")}</Text>
      <Actions>
        {workspaces.map((w) => (
          <Button key={w.id} onClick={() => onPickWorkspace(w.id)}>
            {t("pick", { name: w.name })}
          </Button>
        ))}
      </Actions>
    </div>
  );
}

function RunsList({
  page,
  filter,
  selectedId,
  onFilterChange,
  onSelect,
  runHref,
  workspaceName,
}: RunsScreenProps & { workspaceName: string }) {
  const t = useTranslations("runs");
  const label = useFilterLabel();
  const visible = page.runs.filter((run) => matchesFilter(run, filter));
  const selected = visible.find((run) => run.id === selectedId) ?? visible[0];
  const counts = new Map<RunFilter, number>([["all", page.runs.length]]);
  for (const run of page.runs) {
    const key = filterKeyOf(run);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return (
    <SplitView
      list={
        <>
          <PageHeader title={t("title")} subtitle={t("subtitle", { workspace: workspaceName })} />
          <Tabs<RunFilter> value={filter} onValueChange={onFilterChange} label={t("filter.label")}>
            {RUN_FILTERS.map((key) => (
              <Tab
                key={key}
                value={key}
                count={counts.get(key) ?? 0}
                attention={attentionFilters.has(key)}
              >
                {label(key)}
              </Tab>
            ))}
          </Tabs>
          <Table columns={columns}>
            <TableHead>
              <TableHeader>{t("columns.ticket")}</TableHeader>
              <TableHeader>{t("columns.state")}</TableHeader>
              <TableHeader>{t("columns.agentResult")}</TableHeader>
              <TableHeader>{t("columns.prState")}</TableHeader>
              <TableHeader>{t("columns.runner")}</TableHeader>
              <TableHeader>{t("columns.agent")}</TableHeader>
              <TableHeader align="end">{t("columns.elapsed")}</TableHeader>
            </TableHead>
            {visible.length === 0 ? (
              <TableEmpty>{page.runs.length === 0 ? t("noRuns") : t("empty")}</TableEmpty>
            ) : (
              <TableRows
                label={t("listLabel")}
                value={selected?.id ?? null}
                onValueChange={onSelect}
              >
                {visible.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </TableRows>
            )}
          </Table>
        </>
      }
      panel={
        selected === undefined ? null : (
          <section aria-label={t("panel.label")}>
            <RunPanel run={selected} detailHref={runHref(selected.id)} />
          </section>
        )
      }
    />
  );
}

function RunRow({ run }: { run: RunView }) {
  const agentName = useAgentName();
  const t = useTranslations("runs");
  const domain = useTranslations("domain");
  const { duration, elapsed } = useTime();
  const statusName = useStatusName();
  const status = runStatus(run);
  return (
    <TableRow value={run.id} label={run.ticketKey}>
      <TableCell>
        <RowTitle>{run.ticketKey}</RowTitle>
      </TableCell>
      <TableCell>
        <span {...stylex.props(styles.inline)}>
          <StatusPill status={status}>{statusName(status)}</StatusPill>
          {run.state !== "ended" && run.cancelling ? (
            <Text variant="meta">{t("cancelling")}</Text>
          ) : null}
        </span>
      </TableCell>
      <TableCell>
        {run.state === "ended" ? domain(`agentResult.${run.agentResult}`) : t("notApplicable")}
      </TableCell>
      <TableCell>
        {run.state === "ended" ? domain(`prState.${run.prState}`) : t("notApplicable")}
      </TableCell>
      <TableCell>{run.runner?.name ?? t("notApplicable")}</TableCell>
      <TableCell>{agentName(run.agent)}</TableCell>
      <TableCell align="end" numeric>
        {run.state === "ended" ? duration(elapsedMs(run)) : elapsed(elapsedMs(run))}
      </TableCell>
    </TableRow>
  );
}

function RunPanel({ run, detailHref }: { run: RunView; detailHref: string }) {
  const agentName = useAgentName();
  const t = useTranslations("runs.panel");
  const domain = useTranslations("domain");
  const { duration, elapsed } = useTime();
  const statusName = useStatusName();
  const status = runStatus(run);

  let when: string;
  let reason: string;
  switch (run.state) {
    case "queued":
      when = t("waitingFor", { duration: duration(run.waitMs) });
      reason =
        run.queuedReason.kind === "no-capacity"
          ? domain("queuedReason.no-capacity", { runner: run.queuedReason.runner })
          : domain(`queuedReason.${run.queuedReason.kind}`);
      break;
    case "running":
    case "waiting-for-input":
    case "disconnected":
      when = elapsed(run.executionMs ?? 0);
      reason = t(`reason.${run.state}`);
      break;
    case "ended":
      when = t("endedAfter", { duration: duration(run.executionMs ?? 0) });
      reason = t(`reason.${run.summary}`);
      break;
  }
  // 취소 중이면 그 까닭보다 취소를 먼저 알린다(Q82.21).
  if (run.state !== "ended" && run.cancelling) reason = t("cancellingReason");

  const ended = run.state === "ended" ? run : null;
  const pr = run.pullRequest;
  return (
    <DetailPanel>
      <PanelHeader
        status={
          <>
            <StatusPill status={status}>{statusName(status)}</StatusPill>
            {run.state !== "ended" && run.cancelling ? (
              <Text variant="meta">{t("cancelling")}</Text>
            ) : null}
            <Text variant="meta">{when}</Text>
          </>
        }
        title={run.ticketKey}
        subtitle={
          run.branch === null
            ? run.trackerProject
            : t("subtitle", { project: run.trackerProject, branch: run.branch })
        }
        reason={reason}
      />
      <Actions>
        <a href={detailHref} {...stylex.props(styles.link)}>
          {t("openDetail")}
        </a>
        {pr === null ? null : (
          <a href={pr.url} target="_blank" rel="noreferrer" {...stylex.props(styles.link)}>
            {t("openPr", { pr: pr.displayId })}
          </a>
        )}
      </Actions>
      <DefinitionList>
        <DefinitionItem label={t("state")}>{domain(`runState.${run.state}`)}</DefinitionItem>
        <DefinitionItem label={t("summary")} empty={ended === null}>
          {ended === null ? (
            t("notEnded")
          ) : (
            <StatusPill status={ended.summary}>{statusName(ended.summary)}</StatusPill>
          )}
        </DefinitionItem>
        <DefinitionItem label={t("agentResult")} empty={ended === null}>
          {ended === null ? t("notEnded") : domain(`agentResult.${ended.agentResult}`)}
        </DefinitionItem>
        <DefinitionItem label={t("prState")} empty={ended === null}>
          {ended === null ? t("notEnded") : domain(`prState.${ended.prState}`)}
        </DefinitionItem>
        <DefinitionItem label={t("runner")} empty={run.runner === null}>
          {run.runner === null ? (
            t("noRunner")
          ) : (
            <span {...stylex.props(styles.inline)}>
              {run.runner.name}
              {run.runner.online ? null : <Text variant="meta">{t("runnerOffline")}</Text>}
            </span>
          )}
        </DefinitionItem>
        <DefinitionItem label={t("agent")}>{agentName(run.agent)}</DefinitionItem>
        {run.state === "queued" ? (
          <DefinitionItem label={t("waited")}>{duration(run.waitMs)}</DefinitionItem>
        ) : (
          <DefinitionItem label={t("elapsed")}>{duration(run.executionMs ?? 0)}</DefinitionItem>
        )}
        <DefinitionItem label={t("pr")} empty={pr === null}>
          {pr === null ? (
            t("none")
          ) : (
            <a href={pr.url} target="_blank" rel="noreferrer" {...stylex.props(styles.link)}>
              {pr.displayId}
            </a>
          )}
        </DefinitionItem>
      </DefinitionList>
    </DetailPanel>
  );
}

function useFilterLabel(): (filter: RunFilter) => string {
  const t = useTranslations("runs.filter");
  const statusName = useStatusName();
  return (filter) => (filter === "all" ? t("all") : statusName(filter));
}

const styles = stylex.create({
  notice: {
    maxWidth: 720,
    paddingTop: space.s8,
    paddingInline: space.s8,
    paddingBottom: space.s10,
  },
  stack: { display: "flex", flexDirection: "column", gap: space.s4 },
  inline: { display: "inline-flex", alignItems: "baseline", gap: space.s2 },
  link: {
    color: colors.accentText,
    textUnderlineOffset: 3,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
});

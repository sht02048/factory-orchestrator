import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  Card,
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
  TableRow,
  TableRows,
  Tabs,
  Text,
} from "@factory/ui";
import { colors, fontSize, space } from "@factory/ui/tokens.stylex";
import { useEffect, useRef } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { useAgentName } from "../labels";
import { runStatus, useStatusName } from "../status";
import type { WorkspaceSummary } from "../shell/model";
import {
  ENDED_RUNS_PAGE_SIZE,
  RUN_FILTERS,
  elapsedMs,
  filterKeyOf,
  matchesFilter,
  needsAttention,
} from "./model";
import type { RunFilter, RunView, RunsPage } from "./model";

// 티켓(키 + 흐린 줄) | 상태 알약 | 시간
const columns = "minmax(0, 1fr) 160px 88px";

export interface RunsScreenProps {
  page: RunsPage;
  /** "전체"에서 고를 Workspace 들 */
  workspaces: ReadonlyArray<WorkspaceSummary>;
  filter: RunFilter;
  /** 고른 런. 없거나 목록에 없으면 첫 행을 고른다 */
  selectedId: string | undefined;
  onFilterChange: (filter: RunFilter) => void;
  onSelect: (runId: string) => void;
  /** 행을 연다(두 번 누르기, Enter): Run 상세로 간다(ADR 0010) */
  onOpen: (runId: string) => void;
  onPickWorkspace: (workspaceId: string) => void;
  onShowMoreEnded?: () => void;
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
      return <RunsList {...props} />;
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
  onOpen,
  onShowMoreEnded,
  runHref,
}: RunsScreenProps) {
  const t = useTranslations("runs");
  const label = useFilterLabel();
  const visible = page.runs.filter((run) => matchesFilter(run, filter));
  const selected = visible.find((run) => run.id === selectedId) ?? visible[0];
  const attention = page.runs.filter(needsAttention).length;
  const counts = new Map<RunFilter, number>([
    ["all", page.runs.length],
    ["attention", attention],
  ]);
  for (const run of page.runs) {
    const key = filterKeyOf(run);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const endedShown = page.runs.filter((run) => run.state === "ended").length;
  const showMoreButton = useRef<HTMLButtonElement>(null);
  const endedStatus = useRef<HTMLParagraphElement>(null);
  const focusAfterMore = useRef(false);
  useEffect(() => {
    if (!focusAfterMore.current) return;
    focusAfterMore.current = false;
    (showMoreButton.current ?? endedStatus.current)?.focus();
  }, [page]);

  return (
    <SplitView
      list={
        <>
          <PageHeader
            title={t("title")}
            subtitle={t(page.moreEnded ? "subtitleRecent" : "subtitle", {
              total: page.runs.length,
              attention,
            })}
          />
          <Tabs<RunFilter>
            value={filter}
            onValueChange={onFilterChange}
            label={t("filter.label")}
            variant="chips"
          >
            {RUN_FILTERS.map((key) => (
              <Tab
                key={key}
                value={key}
                count={counts.get(key) ?? 0}
                attention={key === "attention"}
              >
                {label(key)}
              </Tab>
            ))}
          </Tabs>
          <Card padding="compact" label={t("listLabel")}>
            <Table columns={columns}>
              {visible.length === 0 ? (
                <TableEmpty>{page.runs.length === 0 ? t("noRuns") : t("empty")}</TableEmpty>
              ) : (
                <TableRows
                  label={t("listLabel")}
                  value={selected?.id ?? null}
                  onValueChange={onSelect}
                >
                  {visible.map((run) => (
                    <RunRow key={run.id} run={run} onOpen={() => onOpen(run.id)} />
                  ))}
                </TableRows>
              )}
            </Table>
          </Card>
          {page.moreEnded || endedShown > ENDED_RUNS_PAGE_SIZE ? (
            <div {...stylex.props(styles.more)}>
              <p ref={endedStatus} role="status" tabIndex={-1} {...stylex.props(styles.moreStatus)}>
                {page.moreEnded
                  ? t("ended.partial", { count: endedShown })
                  : t("ended.all", { count: endedShown })}
              </p>
              {page.moreEnded && onShowMoreEnded !== undefined ? (
                <Button
                  ref={showMoreButton}
                  onClick={() => {
                    focusAfterMore.current = true;
                    onShowMoreEnded();
                  }}
                >
                  {t("ended.showMore")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      }
      panel={
        <section aria-label={t("panel.label")}>
          {selected === undefined ? (
            <DetailPanel>
              <Text variant="meta">{t("panel.empty")}</Text>
            </DetailPanel>
          ) : (
            <RunPanel
              run={selected}
              detailHref={runHref(selected.id)}
              onOpenDetail={() => onOpen(selected.id)}
            />
          )}
        </section>
      }
    />
  );
}

/** 둥근 행: 키(제목 자리) + 흐린 줄(러너·에이전트), 상태 알약, 경과 또는 상대 시간 */
function RunRow({ run, onOpen }: { run: RunView; onOpen: () => void }) {
  const agentName = useAgentName();
  const t = useTranslations("runs");
  const domain = useTranslations("domain");
  const { ago, elapsed } = useTime();
  const statusName = useStatusName();
  const status = runStatus(run);

  const meta: string[] = [
    run.runner?.name ?? (run.state === "ended" ? t("noRunnerEnded") : t("noRunner")),
  ];
  if (run.state === "ended") {
    // 끝난 런은 에이전트 대신 어떻게 끝났는지(에이전트 결과·PR)를 보인다
    meta.push(domain(`agentResult.${run.agentResult}`));
    // PR 이 있으면 "#128 열림", 없으면 PR 상태가 있을 때만 그 값
    if (run.pullRequest !== null)
      meta.push(
        t("prWithState", {
          pr: run.pullRequest.displayId,
          state: domain(`prState.${run.prState}`),
        }),
      );
    else if (run.prState !== "none") meta.push(domain(`prState.${run.prState}`));
  } else {
    meta.push(agentName(run.agent));
    if (run.cancelling) meta.push(t("cancelling"));
  }

  return (
    <TableRow value={run.id} label={run.ticketKey} onOpen={onOpen}>
      <TableCell>
        <span {...stylex.props(styles.rowText)}>
          {/* 티켓 제목을 저장하면 회색 키 + 제목으로 바꾼다(ADR 0010 9번). 지금은 키만 있다. */}
          <RowTitle>{run.ticketKey}</RowTitle>
          <Text variant="meta">{meta.join(t("metaSeparator"))}</Text>
        </span>
      </TableCell>
      <TableCell align="end">
        <StatusPill status={status}>{statusName(status)}</StatusPill>
      </TableCell>
      <TableCell align="end" numeric>
        {run.state === "ended" ? ago(run.endedAt, run.endedAgoMs) : elapsed(elapsedMs(run))}
      </TableCell>
    </TableRow>
  );
}

function RunPanel({
  run,
  detailHref,
  onOpenDetail,
}: {
  run: RunView;
  detailHref: string;
  onOpenDetail: () => void;
}) {
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
        <a
          href={detailHref}
          onClick={(event) => {
            if (!isPlainClick(event)) return;
            event.preventDefault();
            onOpenDetail();
          }}
          {...stylex.props(styles.link)}
        >
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
              {run.runner.online ? null : (
                <StatusPill status="offline">{statusName("offline")}</StatusPill>
              )}
            </span>
          )}
        </DefinitionItem>
        <DefinitionItem label={t("agent")}>{agentName(run.agent)}</DefinitionItem>
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

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function useFilterLabel(): (filter: RunFilter) => string {
  const t = useTranslations("runs.filter");
  const statusName = useStatusName();
  return (filter) => (filter === "all" || filter === "attention" ? t(filter) : statusName(filter));
}

const styles = stylex.create({
  notice: {
    maxWidth: 720,
    paddingTop: space.s8,
    paddingInline: space.s8,
    paddingBottom: space.s10,
  },
  stack: { display: "flex", flexDirection: "column", gap: space.s4 },
  inline: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  more: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
    marginTop: space.s4,
  },
  moreStatus: {
    margin: 0,
    color: colors.textTertiary,
    fontSize: fontSize.ui,
    outline: "none",
  },
  rowText: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  link: {
    color: colors.accentText,
    textUnderlineOffset: 3,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
});

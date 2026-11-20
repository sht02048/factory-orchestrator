import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  buttonStyles,
  Card,
  DefinitionItem,
  DefinitionList,
  DetailPanel,
  Input,
  MascotMessage,
  NoticeLayout,
  PageHeader,
  ScreenLayout,
  PanelFooter,
  RowTitle,
  SegmentedTabs,
  SplitView,
  StatusPill,
  Table,
  TableCell,
  TableEmpty,
  TableFoldedOnly,
  TableHead,
  TableHeader,
  TableRow,
  TableRows,
  Text,
  VisuallyHidden,
  showToast,
} from "@ganger/ui";
import { size, space } from "@ganger/ui/tokens.stylex";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import type { WorkspaceSummary } from "@ganger/app/shell/model";
import { runStatus, useStatusName } from "../status";
import type { AssignInput, AssignResult } from "@ganger/app/tickets/assign";
import { AssignDialog } from "./assign-dialog";
import {
  TICKET_FILTERS,
  countByFilter,
  lastRun,
  matchesFilter,
  matchesSearch,
} from "@ganger/app/tickets/model";
import type { TicketFilter, TicketRun, TicketView, TicketsPage } from "@ganger/app/tickets/model";
import { useRowWindow } from "./row-window";

export interface TicketsScreenProps {
  page: TicketsPage;
  workspaces: ReadonlyArray<WorkspaceSummary>;
  filter: TicketFilter;
  selectedId: string | undefined;
  onFilterChange: (filter: TicketFilter) => void;
  onSelect: (ticketId: string) => void;
  onPickWorkspace: (workspaceId: string) => void;
  onOpenRun: (runId: string) => void;
  onAssign: (input: AssignInput) => Promise<AssignResult>;
  onAssigned: (ticketId: string) => void;
  onReread: () => Promise<void>;
}

export function TicketsScreen(props: TicketsScreenProps) {
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
      return <TicketsList key={page.workspace.workspace.id} {...props} />;
  }
}

function Notice({ body }: { body: ReactNode }) {
  const t = useTranslations("tickets");
  return (
    <ScreenLayout header={<PageHeader title={t("title")} subtitle={t("intro")} />}>
      <NoticeLayout>{body}</NoticeLayout>
    </ScreenLayout>
  );
}

function NoWorkspace() {
  const t = useTranslations("tickets");
  return <Text variant="body">{t("noWorkspace")}</Text>;
}

function AllWorkspaces({
  workspaces,
  onPickWorkspace,
}: {
  workspaces: ReadonlyArray<WorkspaceSummary>;
  onPickWorkspace: (workspaceId: string) => void;
}) {
  const t = useTranslations("tickets.allWorkspaces");
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

type RereadResult = "idle" | "reading" | "checking" | "failed" | "partial";

function useReread(onReread: () => Promise<void>, page: TicketsPage) {
  const t = useTranslations("tickets.reread");
  const [result, setResult] = useState<RereadResult>("idle");
  const failedProjects = page.errors.length;
  const [failedOn, setFailedOn] = useState<TicketsPage | null>(null);
  if (result === "failed" && failedOn !== null && failedOn !== page) {
    setResult("idle");
    setFailedOn(null);
  }
  useEffect(() => {
    if (result !== "checking") return;
    if (failedProjects > 0) {
      setResult("partial");
      return;
    }
    setResult("idle");
    showToast(t("done"));
  }, [result, failedProjects, t]);
  const start = () => {
    setResult("reading");
    onReread().then(
      () => setResult("checking"),
      () => {
        setFailedOn(page);
        setResult("failed");
      },
    );
  };
  return { result, start };
}

export const REREAD_ANNOUNCE_MS = 5_000;

function useAnnouncement(result: RereadResult): RereadResult {
  const [announced, setAnnounced] = useState<RereadResult>("idle");
  useEffect(() => {
    setAnnounced(result);
    if (result !== "failed" && result !== "partial") return;
    const timer = setTimeout(() => setAnnounced("idle"), REREAD_ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [result]);
  return announced;
}

function RereadButton({ result, onStart }: { result: RereadResult; onStart: () => void }) {
  const t = useTranslations("tickets.reread");
  const announced = useAnnouncement(result);
  return (
    <>
      <Button busy={{ active: result === "reading", label: t("reading") }} onClick={onStart}>
        {t("action")}
      </Button>
      <VisuallyHidden>
        <span role="status">
          {announced === "failed" ? t("failed") : announced === "partial" ? t("partial") : ""}
        </span>
      </VisuallyHidden>
    </>
  );
}

const withoutTrackerProject = [size.ticketKeyColumn, "minmax(0, 1fr)", size.lastRunColumn].join(
  " ",
);
const withTrackerProject = [
  size.ticketKeyColumn,
  "minmax(0, 1fr)",
  size.projectColumn,
  size.lastRunColumn,
].join(" ");
const trackerProjectFolded = { first: withTrackerProject, second: withoutTrackerProject };

function TicketsList({
  page,
  filter,
  selectedId,
  onFilterChange,
  onSelect,
  onOpenRun,
  onAssign,
  onAssigned,
  onReread,
}: TicketsScreenProps) {
  const t = useTranslations("tickets");
  const reread = useReread(onReread, page);
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () =>
      page.tickets.filter(
        (ticket) => matchesFilter(ticket, filter) && matchesSearch(ticket, query),
      ),
    [page.tickets, filter, query],
  );
  const counts = useMemo(() => countByFilter(page.tickets), [page.tickets]);
  const selected =
    visible.find((ticket) => ticket.id === selectedId) ??
    page.tickets.find((ticket) => ticket.id === selectedId) ??
    visible[0];
  const selectedIndex = selected === undefined ? -1 : visible.indexOf(selected);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useRowWindow(listRef, visible.length, selectedIndex);
  const moreBelow = useMoreBelow(scrollRef, listRef, visible.length);
  const [assignedId, setAssignedId] = useState<string | null>(null);
  const showTrackerProject = page.trackerProjectCount > 1;

  let empty: string;
  const filtered = counts[filter] > 0;
  if (query.trim() !== "" && filtered) empty = t("noMatch", { query: query.trim() });
  else if (page.tickets.length > 0 || page.errors.length > 0) empty = t("empty");
  else if (page.trackerProjectCount === 0) empty = t("noProjects");
  else empty = t("noTickets");

  return (
    <ScreenLayout
      header={
        <PageHeader
          title={t("title")}
          subtitle={t("summary", { count: counts.assignable })}
          {...(page.trackerProjectCount === 0
            ? {}
            : {
                actions: <RereadButton result={reread.result} onStart={reread.start} />,
              })}
        />
      }
    >
      <SplitView
        fill={false}
        stackedListShare="larger"
        list={
          <div {...stylex.props(styles.listFrame)}>
            <div {...stylex.props(styles.listTop)}>
              {page.errors.length === 0 && reread.result !== "failed" ? null : (
                <Card surface="problem">
                  <div {...stylex.props(styles.lines)}>
                    {reread.result === "failed" ? (
                      <Text variant="body">{t("reread.failed")}</Text>
                    ) : null}
                    {page.errors.map((error) => (
                      <Text key={error.trackerProject} variant="body">
                        {t(`loadError.${error.reason}`, { project: error.trackerProject })}
                      </Text>
                    ))}
                  </div>
                </Card>
              )}
              {page.truncated.length === 0 ? null : (
                <div {...stylex.props(styles.lines)}>
                  {page.truncated.map((cut) => (
                    <Text key={cut.trackerProject} variant="meta">
                      {t("truncated", { project: cut.trackerProject, limit: cut.limit })}
                    </Text>
                  ))}
                </div>
              )}
              <div {...stylex.props(styles.toolbar)}>
                <SegmentedTabs<TicketFilter>
                  value={filter}
                  onValueChange={onFilterChange}
                  label={t("filter.label")}
                  items={TICKET_FILTERS.map((key) => ({
                    value: key,
                    label: t(`filter.${key}`),
                    count: counts[key],
                  }))}
                />
                <div {...stylex.props(styles.search)}>
                  <Input
                    type="search"
                    aria-label={t("search.label")}
                    value={query}
                    onValueChange={setQuery}
                    placeholder={t("search.placeholder")}
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
            <div {...stylex.props(styles.tableFrame)}>
              <Table
                columns={showTrackerProject ? withTrackerProject : withoutTrackerProject}
                {...(showTrackerProject ? { foldedColumns: trackerProjectFolded } : {})}
                narrowColumns="minmax(0, 1fr)"
              >
                <TableHead>
                  <TableHeader>{t("columns.key")}</TableHeader>
                  <TableHeader>{t("columns.title")}</TableHeader>
                  {showTrackerProject ? (
                    <TableHeader hideWhen="second">{t("columns.trackerProject")}</TableHeader>
                  ) : null}
                  <TableHeader>{t("columns.lastRun")}</TableHeader>
                </TableHead>
                <div
                  ref={scrollRef}
                  data-more-below={moreBelow}
                  {...stylex.props(styles.scroll, moreBelow && styles.fadeBottom)}
                >
                  <div ref={listRef}>
                    {visible.length === 0 ? (
                      <TableEmpty>
                        {page.tickets.length === 0 && page.errors.length === 0 ? (
                          <MascotMessage mood="resting" size="small">
                            {empty}
                          </MascotMessage>
                        ) : (
                          empty
                        )}
                      </TableEmpty>
                    ) : (
                      <TableRows
                        label={t("listLabel")}
                        value={visible[selectedIndex]?.id ?? null}
                        onValueChange={onSelect}
                      >
                        {rows.spaceBefore > 0 ? (
                          <div aria-hidden="true" style={{ height: rows.spaceBefore }} />
                        ) : null}
                        {visible.slice(rows.start, rows.end).map((ticket) => (
                          <TicketRow
                            key={ticket.id}
                            ticket={ticket}
                            showTrackerProject={showTrackerProject}
                          />
                        ))}
                        {rows.spaceAfter > 0 ? (
                          <div aria-hidden="true" style={{ height: rows.spaceAfter }} />
                        ) : null}
                      </TableRows>
                    )}
                  </div>
                </div>
              </Table>
            </div>
          </div>
        }
        panel={
          selected === undefined ? null : (
            <section aria-label={t("panel.label")}>
              <TicketPanel
                key={selected.id}
                ticket={selected}
                page={page}
                onOpenRun={onOpenRun}
                onAssign={onAssign}
                onAssigned={() => {
                  setAssignedId(selected.id);
                  onAssigned(selected.id);
                }}
                focusOpenRun={assignedId === selected.id}
                onFocusedOpenRun={() => setAssignedId(null)}
              />
            </section>
          )
        }
      />
    </ScreenLayout>
  );
}

function useMoreBelow(
  scrollRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  rowCount: number,
): boolean {
  const [moreBelow, setMoreBelow] = useState(false);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller === null) return;
    const update = () => {
      setMoreBelow(scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1);
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    if (contentRef.current !== null) observer.observe(contentRef.current);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [scrollRef, contentRef, rowCount]);
  return moreBelow;
}

function TicketRow({
  ticket,
  showTrackerProject,
}: {
  ticket: TicketView;
  showTrackerProject: boolean;
}) {
  const run = lastRun(ticket);
  return (
    <TableRow value={ticket.id} label={`${ticket.key} ${ticket.title}`}>
      <TableCell>
        <Text variant="meta" numeric>
          {ticket.key}
        </Text>
      </TableCell>
      <TableCell>
        <RowTitle fullText={ticket.title}>{ticket.title}</RowTitle>
        {showTrackerProject ? (
          <TableFoldedOnly when="second" block>
            <Text variant="meta">{ticket.trackerProject.name}</Text>
          </TableFoldedOnly>
        ) : null}
      </TableCell>
      {showTrackerProject ? (
        <TableCell hideWhen="second">
          <Text variant="meta">{ticket.trackerProject.name}</Text>
        </TableCell>
      ) : null}
      <TableCell>
        <LastRunStatus run={run} />
      </TableCell>
    </TableRow>
  );
}

function LastRunStatus({ run }: { run: TicketRun | undefined }) {
  const t = useTranslations("tickets");
  const statusName = useStatusName();
  if (run === undefined) return <Text variant="meta">{t("unassigned")}</Text>;
  const status = runStatus(run);
  return <StatusPill status={status}>{statusName(status)}</StatusPill>;
}

type NextStep =
  | "unassigned"
  | "no-mapping"
  | "queued"
  | "running"
  | "waiting-for-input"
  | "paused"
  | "disconnected"
  | "merged"
  | "human-check"
  | "human-check-settled"
  | "failed"
  | "canceled";

function nextStepOf(ticket: TicketView): NextStep {
  const run = lastRun(ticket);
  if (ticket.assignability.kind === "no-mapping") return "no-mapping";
  if (run === undefined) return "unassigned";
  if (run.state !== "ended") return run.state;
  if (run.summary === "human-check" && run.prSettledLater) return "human-check-settled";
  return run.summary;
}

function TicketPanel({
  ticket,
  page,
  onOpenRun,
  onAssign,
  onAssigned,
  focusOpenRun,
  onFocusedOpenRun,
}: {
  ticket: TicketView;
  page: TicketsPage;
  onOpenRun: (runId: string) => void;
  onAssign: TicketsScreenProps["onAssign"];
  onAssigned: () => void;
  focusOpenRun: boolean;
  onFocusedOpenRun: () => void;
}) {
  const t = useTranslations("tickets.panel");
  const run = lastRun(ticket);
  const { assignability } = ticket;
  const openRunRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!focusOpenRun) return;
    const button = openRunRef.current?.querySelector("button");
    if (button === null || button === undefined) return;
    button.focus();
    onFocusedOpenRun();
  }, [focusOpenRun, assignability.kind, onFocusedOpenRun]);

  const openRunId = assignability.kind === "active-run" ? assignability.runId : run?.id;
  const labels = ticket.labels;
  return (
    <DetailPanel>
      <div {...stylex.props(styles.panelHead)}>
        <Text variant="meta">
          {[ticket.key, ticket.trackerProject.name, ticket.trackerState.name].join(" · ")}
        </Text>
        <Text variant="heading">{ticket.title}</Text>
      </div>
      <Card surface="inset" label={t("lastRun")}>
        <div {...stylex.props(styles.lastRun)}>
          <Text variant="label">{t("lastRun")}</Text>
          <div {...stylex.props(styles.lastRunState)}>
            <LastRunStatus run={run} />
            {run === undefined ? null : <RunTiming run={run} />}
          </div>
          <Text variant="body">{t(`next.${nextStepOf(ticket)}`)}</Text>
          <Actions>
            {assignability.kind === "ready" ? (
              <AssignDialog
                ticket={ticket}
                defaults={assignability.defaults}
                runners={page.runners}
                agents={page.agents}
                triggerLabel={run === undefined ? t("assign") : t("reassign")}
                onAssign={onAssign}
                onAssigned={onAssigned}
              />
            ) : null}
            {openRunId === undefined ? null : (
              <span ref={openRunRef} {...stylex.props(styles.contents)}>
                <Button onClick={() => onOpenRun(openRunId)}>{t("openRun")}</Button>
              </span>
            )}
          </Actions>
        </div>
      </Card>
      <DefinitionList>
        <DefinitionItem label={t("labels")} empty={labels.length === 0}>
          {labels.length === 0 ? (
            t("none")
          ) : (
            <span {...stylex.props(styles.labels)}>
              {labels.map((label) =>
                label.autoAssign ? (
                  <Text key={label.name} variant="ui">
                    {`${label.name} · ${t("autoAssign")}`}
                  </Text>
                ) : (
                  <Text key={label.name} variant="meta">
                    {label.name}
                  </Text>
                ),
              )}
            </span>
          )}
        </DefinitionItem>
        <DefinitionItem label={t("mapping")} empty={ticket.mapping === null}>
          {ticket.mapping === null
            ? t("noMapping")
            : t("mappingValue", {
                project: ticket.mapping.runnerProject,
                agent: ticket.mapping.agent,
              })}
        </DefinitionItem>
        <DefinitionItem label={t("runCount")}>
          {t("runCountValue", { count: ticket.runs.length })}
        </DefinitionItem>
      </DefinitionList>
      {ticket.url === null ? null : (
        <PanelFooter>
          <a
            href={ticket.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`${t("openInTracker")} (${t("newTab")})`}
            data-variant="ghost"
            {...stylex.props(buttonStyles("ghost"))}
          >
            {t("openInTracker")}
            <span aria-hidden="true"> ↗</span>
          </a>
        </PanelFooter>
      )}
    </DetailPanel>
  );
}

function RunTiming({ run }: { run: TicketRun }) {
  const t = useTranslations("tickets.panel");
  const { ago, elapsed } = useTime();
  const time = run.state === "ended" ? ago(run.endedAt, run.endedAgoMs) : elapsed(run.elapsedMs);
  return (
    <Text variant="meta">
      {run.runnerName === null
        ? t("noRunner", { time })
        : t("runner", { runner: run.runnerName, time })}
    </Text>
  );
}

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.s4 },
  listFrame: {
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    height: "100%",
    minHeight: 0,
  },
  listTop: { display: "flex", flexDirection: "column", gap: space.s4, paddingBottom: space.s4 },
  lines: { display: "flex", flexDirection: "column", gap: space.s1 },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  search: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: size.searchMinWidth,
    maxWidth: size.searchMaxWidth,
  },
  tableFrame: { display: "grid", gridTemplateRows: "minmax(0, 1fr)", minHeight: 0 },
  scroll: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  fadeBottom: {
    maskImage: `linear-gradient(to bottom, currentColor calc(100% - ${space.s10}), transparent)`,
  },
  contents: { display: "contents" },
  panelHead: { display: "flex", flexDirection: "column", gap: space.s2 },
  lastRun: { display: "flex", flexDirection: "column", gap: space.s3 },
  lastRunState: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  labels: { display: "inline-flex", flexWrap: "wrap", gap: space.s2 },
});

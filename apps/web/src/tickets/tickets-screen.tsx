import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  DefinitionItem,
  DefinitionList,
  DetailPanel,
  PageHeader,
  PanelBlock,
  PanelFooter,
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
import { colors, fontSize, fontWeight, space } from "@factory/ui/tokens.stylex";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import type { WorkspaceSummary } from "../shell/model";
import { runStatus, useStatusName } from "../status";
import type { AssignInput, AssignResult } from "./assign";
import { AssignDialog } from "./assign-dialog";
import { TICKET_FILTERS, lastRun, matchesFilter } from "./model";
import type { TicketFilter, TicketView, TicketsPage } from "./model";
import { useRowWindow } from "./row-window";

const columns = "minmax(0, 1fr) 128px 104px 160px";

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
      return <TicketsList {...props} workspaceName={page.workspace.workspace.name} />;
  }
}

function Notice({ body }: { body: ReactNode }) {
  const t = useTranslations("tickets");
  return (
    <div {...stylex.props(styles.notice)}>
      <PageHeader title={t("title")} subtitle={t("summary")} />
      {body}
    </div>
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

function TicketsList({
  page,
  filter,
  selectedId,
  onFilterChange,
  onSelect,
  onOpenRun,
  onAssign,
  onAssigned,
  workspaceName,
}: TicketsScreenProps & { workspaceName: string }) {
  const t = useTranslations("tickets");
  const visible = useMemo(
    () => page.tickets.filter((ticket) => matchesFilter(ticket, filter)),
    [page.tickets, filter],
  );
  const counts = useMemo(() => countByFilter(page.tickets), [page.tickets]);
  const selected =
    visible.find((ticket) => ticket.id === selectedId) ??
    page.tickets.find((ticket) => ticket.id === selectedId) ??
    visible[0];
  const selectedIndex = selected === undefined ? -1 : visible.indexOf(selected);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useRowWindow(listRef, visible.length, selectedIndex);
  const [assignedId, setAssignedId] = useState<string | null>(null);

  let empty: string;
  if (page.tickets.length > 0 || page.errors.length > 0) empty = t("empty");
  else if (!page.hasTrackerProjects) empty = t("noProjects");
  else empty = t("noTickets");

  return (
    <SplitView
      list={
        <>
          <PageHeader title={t("title")} subtitle={t("subtitle", { workspace: workspaceName })} />
          {page.errors.length === 0 ? null : (
            <div {...stylex.props(styles.errors)}>
              {page.errors.map((error) => (
                <Text key={error.trackerProject} variant="body">
                  {t(`loadError.${error.reason}`, { project: error.trackerProject })}
                </Text>
              ))}
            </div>
          )}
          {page.truncated.length === 0 ? null : (
            <div {...stylex.props(styles.truncated)}>
              {page.truncated.map((cut) => (
                <Text key={cut.trackerProject} variant="meta">
                  {t("truncated", { project: cut.trackerProject, limit: cut.limit })}
                </Text>
              ))}
            </div>
          )}
          <Tabs<TicketFilter>
            value={filter}
            onValueChange={onFilterChange}
            label={t("filter.label")}
          >
            {TICKET_FILTERS.map((key) => (
              <Tab key={key} value={key} count={counts[key]} attention={key === "attention"}>
                {t(`filter.${key}`)}
              </Tab>
            ))}
          </Tabs>
          <div ref={listRef}>
            <Table columns={columns}>
              <TableHead>
                <TableHeader>{t("columns.ticket")}</TableHeader>
                <TableHeader>{t("columns.trackerProject")}</TableHeader>
                <TableHeader>{t("columns.trackerState")}</TableHeader>
                <TableHeader>{t("columns.lastRun")}</TableHeader>
              </TableHead>
              {visible.length === 0 ? (
                <TableEmpty>{empty}</TableEmpty>
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
                    <TicketRow key={ticket.id} ticket={ticket} />
                  ))}
                  {rows.spaceAfter > 0 ? (
                    <div aria-hidden="true" style={{ height: rows.spaceAfter }} />
                  ) : null}
                </TableRows>
              )}
            </Table>
          </div>
        </>
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
  );
}

function countByFilter(tickets: ReadonlyArray<TicketView>): Record<TicketFilter, number> {
  const counts: Record<TicketFilter, number> = {
    all: 0,
    attention: 0,
    unassigned: 0,
    running: 0,
    merged: 0,
  };
  for (const ticket of tickets) {
    for (const key of TICKET_FILTERS) if (matchesFilter(ticket, key)) counts[key] += 1;
  }
  return counts;
}

function TicketRow({ ticket }: { ticket: TicketView }) {
  const t = useTranslations("tickets");
  const statusName = useStatusName();
  const run = lastRun(ticket);
  return (
    <TableRow value={ticket.id} label={`${ticket.key} ${ticket.title}`}>
      <TableCell>
        <span {...stylex.props(styles.ticketCell)}>
          <span {...stylex.props(styles.key)}>{ticket.key}</span>
          <RowTitle>{ticket.title}</RowTitle>
        </span>
      </TableCell>
      <TableCell>{ticket.trackerProject.name}</TableCell>
      <TableCell>{ticket.trackerState.name}</TableCell>
      <TableCell>
        {run === undefined ? (
          <Text variant="meta">{t("unassigned")}</Text>
        ) : (
          <StatusPill status={runStatus(run)}>{statusName(runStatus(run))}</StatusPill>
        )}
      </TableCell>
    </TableRow>
  );
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
  const tList = useTranslations("tickets");
  const statusName = useStatusName();
  const { ago } = useTime();
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

  let reason: string;
  if (assignability.kind === "active-run") reason = t("reason.active-run");
  else if (assignability.kind === "no-mapping") reason = t("reason.no-mapping");
  else if (run === undefined) reason = t("reason.unassigned");
  else if (run.state === "ended") reason = t(`reason.${run.summary}`);
  else reason = t("reason.active-run");

  const labels = ticket.labels;
  return (
    <DetailPanel>
      <PanelHeader
        status={
          run === undefined ? (
            <Text variant="meta">{tList("unassigned")}</Text>
          ) : (
            <>
              <StatusPill status={runStatus(run)}>{statusName(runStatus(run))}</StatusPill>
              <Text variant="meta">{t("lastRun")}</Text>
            </>
          )
        }
        title={
          <span {...stylex.props(styles.ticketCell)}>
            <span {...stylex.props(styles.key, styles.panelKey)}>{ticket.key}</span>
            <span>{ticket.title}</span>
          </span>
        }
        subtitle={t("subtitle", {
          project: ticket.trackerProject.name,
          state: ticket.trackerState.name,
        })}
        reason={reason}
      />
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
        {assignability.kind === "active-run" ? (
          <span ref={openRunRef} {...stylex.props(styles.contents)}>
            <Button onClick={() => onOpenRun(assignability.runId)}>{t("openRun")}</Button>
          </span>
        ) : null}
      </Actions>
      <DefinitionList>
        <DefinitionItem label={t("trackerState")}>
          <span {...stylex.props(styles.inline)}>
            {ticket.trackerState.name}
            <Text variant="meta">{t("trackerStateNote")}</Text>
          </span>
        </DefinitionItem>
        <DefinitionItem label={t("labels")} empty={labels.length === 0}>
          {labels.length === 0 ? (
            t("none")
          ) : (
            <span {...stylex.props(styles.labels)}>
              {labels.map((label) => (
                <span
                  key={label.name}
                  {...stylex.props(label.autoAssign ? styles.autoLabel : styles.label)}
                >
                  {label.name}
                  {label.autoAssign ? ` · ${t("autoAssign")}` : null}
                </span>
              ))}
            </span>
          )}
        </DefinitionItem>
        <DefinitionItem label={t("mapping")} empty={assignability.kind === "no-mapping"}>
          {assignability.kind === "ready"
            ? t("mappingValue", {
                project: assignability.defaults.runnerProject,
                agent: assignability.defaults.agent,
              })
            : assignability.kind === "no-mapping"
              ? t("noMapping")
              : t("none")}
        </DefinitionItem>
      </DefinitionList>
      {ticket.runs.length === 0 ? null : (
        <PanelBlock title={t("history", { count: ticket.runs.length })}>
          <ol {...stylex.props(styles.history)}>
            {ticket.runs.map((r) => (
              <li key={r.id} {...stylex.props(styles.historyRow)}>
                <StatusPill status={runStatus(r)}>{statusName(runStatus(r))}</StatusPill>
                <Text variant="meta">
                  <time dateTime={r.assignedAt}>{ago(r.assignedAt, r.assignedAgoMs)}</time>
                </Text>
              </li>
            ))}
          </ol>
        </PanelBlock>
      )}
      {ticket.url === null ? null : (
        <PanelFooter>
          <a href={ticket.url} target="_blank" rel="noreferrer" {...stylex.props(styles.link)}>
            {t("openInTracker")}
            <span aria-hidden="true"> ↗</span>
            <span {...stylex.props(styles.srOnly)}>{` (${t("newTab")})`}</span>
          </a>
        </PanelFooter>
      )}
    </DetailPanel>
  );
}

const styles = stylex.create({
  notice: {
    maxWidth: 720,
    paddingTop: space.s8,
    paddingInline: space.s8,
    paddingBottom: space.s10,
  },
  stack: { display: "flex", flexDirection: "column", gap: space.s4 },
  errors: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    paddingBlock: space.s3,
    color: colors.problem,
  },
  truncated: { display: "flex", flexDirection: "column", gap: space.s1, paddingBlock: space.s3 },
  contents: { display: "contents" },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
  inline: { display: "inline-flex", alignItems: "baseline", gap: space.s2 },
  ticketCell: { display: "flex", alignItems: "baseline", gap: space.s2, minWidth: 0 },
  key: {
    flexShrink: 0,
    color: colors.textTertiary,
    fontSize: fontSize.ui,
    fontWeight: fontWeight.regular,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  panelKey: { fontSize: "inherit" },
  labels: { display: "inline-flex", flexWrap: "wrap", gap: space.s2 },
  label: { color: colors.textTertiary },
  autoLabel: { color: colors.accentText },
  history: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  historyRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: space.s3,
    paddingBlock: space.s2,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  link: {
    color: colors.accentText,
    textUnderlineOffset: 3,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
});

import * as stylex from "@stylexjs/stylex";
import {
  Button,
  buttonStyles,
  CapacityBar,
  DetailPanel,
  MascotMessage,
  PageHeader,
  PanelBlock,
  ProblemCallout,
  Row,
  RowTitle,
  SplitView,
  StatusPill,
  Table,
  TableCell,
  TableRow,
  TableRows,
  Text,
  textStyles,
} from "@ganger/ui";
import { fonts, size, space } from "@ganger/ui/tokens.stylex";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { usePrerequisiteName } from "../labels";
import { useRunnerCheckPolling } from "../settings/settings-screen";
import type { ActionResult } from "../settings/settings-screen";
import { useStatusName } from "../status";
import { failedChecksFirst, problemRunnersFirst, runnerRowStatus } from "@ganger/app/runners/model";
import type { RunnerCheckItem, RunnerView, RunnersPage } from "@ganger/app/runners/model";

export function addRunnerHref(ws: string | undefined): string {
  const search = new URLSearchParams(ws === undefined ? {} : { ws });
  search.set("sel", "runners");
  return `/settings?${search.toString()}`;
}

export interface RunnerActions {
  recheck: (input: { id: string }) => Promise<ActionResult>;
  pollChecks: () => Promise<boolean>;
}

export interface RunnersScreenProps {
  page: RunnersPage;
  selectedId: string | undefined;
  ws: string | undefined;
  onSelect: (id: string) => void;
  actions: RunnerActions;
}

const columns = `${size.runnerStatusColumn} minmax(0, 1fr) ${size.capacityColumn}`;

export function RunnersScreen({ page, selectedId, ws, onSelect, actions }: RunnersScreenProps) {
  const t = useTranslations("runners");
  const runners = problemRunnersFirst(page.runners);
  const issues = runners.filter((r) => runnerRowStatus(r) !== "online").length;
  const available = runners.filter(
    (r) => runnerRowStatus(r) === "online" && r.occupying.length < r.capacity,
  ).length;
  const selected = runners.find((r) => r.id === selectedId) ?? runners[0];

  useEffect(() => {
    if (selectedId === undefined) return;
    const option = document.getElementById(rowMarkerId(selectedId))?.closest('[role="option"]');
    if (!(option instanceof HTMLElement) || option.contains(document.activeElement)) return;
    option.scrollIntoView({ block: "nearest" });
    option.focus({ preventScroll: true });
  }, [selectedId]);

  return (
    <SplitView
      list={
        <>
          <PageHeader
            title={t("title")}
            subtitle={
              runners.length === 0
                ? undefined
                : t("subtitle", { total: runners.length, available, issues })
            }
            actions={
              <a
                href={addRunnerHref(ws)}
                data-variant="primary"
                {...stylex.props(...buttonStyles("primary"))}
              >
                {t("add")}
              </a>
            }
          />
          {runners.length === 0 ? (
            <EmptyRunners />
          ) : (
            <Table columns={columns}>
              <TableRows
                label={t("listLabel")}
                value={selected?.id ?? null}
                onValueChange={onSelect}
              >
                {runners.map((runner) => (
                  <RunnerRow key={runner.id} runner={runner} />
                ))}
              </TableRows>
            </Table>
          )}
        </>
      }
      panel={
        <section aria-label={t("panel.label")}>
          {selected === undefined ? (
            <DetailPanel>
              {runners.length === 0 ? null : <Text variant="meta">{t("panel.empty")}</Text>}
            </DetailPanel>
          ) : (
            <RunnerPanel key={selected.id} runner={selected} actions={actions} />
          )}
        </section>
      }
    />
  );
}

function EmptyRunners() {
  const t = useTranslations("runners.empty");
  return (
    <MascotMessage mood="resting" align="start">
      <Text variant="title">{t("title")}</Text>
      <Text variant="body">{t("body")}</Text>
    </MascotMessage>
  );
}

export function rowMarkerId(runnerId: string): string {
  return `runner-${runnerId}`;
}

function RunnerRow({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners");
  const statusName = useStatusName();
  const status = runnerRowStatus(runner);
  return (
    <TableRow value={runner.id} label={runner.name}>
      <TableCell>
        <StatusPill status={status}>{statusName(status)}</StatusPill>
      </TableCell>
      <TableCell>
        <span id={rowMarkerId(runner.id)} {...stylex.props(styles.rowText)}>
          <span {...stylex.props(styles.rowHead)}>
            <RowTitle>{runner.name}</RowTitle>
            {runner.sshTarget === null ? null : (
              <Text variant="meta" mono truncate>
                {runner.sshTarget}
              </Text>
            )}
          </span>
          <Text variant="meta" truncate>
            <RowSentence runner={runner} />
          </Text>
        </span>
      </TableCell>
      <TableCell>
        <CapacityBar
          used={runner.occupying.length}
          total={runner.capacity}
          label={t("capacityLabel", { name: runner.name })}
          tone={status === "online" ? "progress" : "problem"}
        />
      </TableCell>
    </TableRow>
  );
}

function RowSentence({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.row");
  const { duration } = useTime();
  const free = Math.max(0, runner.capacity - runner.occupying.length);
  if (!runner.online)
    return runner.offlineMs === null
      ? t("offline")
      : t("offlineFor", { duration: duration(runner.offlineMs) });
  if (runner.assignmentBlocked) return t("assignmentBlocked");
  if (free > 0) return t("free", { free });
  return runner.queued.length === 0 ? t("full") : t("fullWaiting", { count: runner.queued.length });
}

function RunnerPanel({ runner, actions }: { runner: RunnerView; actions: RunnerActions }) {
  const t = useTranslations("runners.panel");
  const statusName = useStatusName();
  const { ago } = useTime();
  const status = runnerRowStatus(runner);
  const recheck = useRecheck(runner.id, actions);
  return (
    <DetailPanel>
      <div {...stylex.props(styles.panelHead)}>
        <div {...stylex.props(styles.statusLine)}>
          <StatusPill status={status}>{statusName(status)}</StatusPill>
          <Text variant="meta">
            {runner.checked === null
              ? t("neverChecked")
              : t("checkedAgo", { time: ago(runner.checked.at, runner.checked.agoMs) })}
          </Text>
        </div>
        <div {...stylex.props(styles.wrap)}>
          <Text variant="heading">{runner.name}</Text>
          {runner.sshTarget === null ? null : (
            <Text variant="meta" as="p" mono>
              {runner.sshTarget}
            </Text>
          )}
        </div>
        <p
          ref={recheck.statusRef}
          role="status"
          tabIndex={-1}
          {...stylex.props(textStyles("meta"))}
        >
          {recheck.message === null ? null : t(`recheckStatus.${recheck.message}`)}
        </p>
      </div>
      {status === "online" ? null : (
        <FixCallout
          cause={status === "offline" ? "offline" : "assignmentBlocked"}
          checking={recheck.checking}
          onRecheck={recheck.request}
        />
      )}
      <RunList runner={runner} />
      <CheckList runner={runner} />
      <LeftWorktrees runner={runner} />
    </DetailPanel>
  );
}

type RecheckPhase = "idle" | "sending" | "requested" | "done" | "failed";
type RecheckMessage = "requested" | "done" | "failed" | "silent";

function useRecheck(runnerId: string, { recheck, pollChecks }: RunnerActions) {
  const [phase, setPhase] = useState<RecheckPhase>("idle");
  const [pendingKey, setPendingKey] = useState("");
  const statusRef = useRef<HTMLParagraphElement>(null);

  const focusStatusIfLost = useCallback(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) statusRef.current?.focus();
  }, []);

  const poll = useCallback(async () => {
    const still = await pollChecks();
    if (!still) {
      setPhase("done");
      setPendingKey("");
      focusStatusIfLost();
    }
    return still;
  }, [pollChecks, focusStatusIfLost]);
  const silent = useRunnerCheckPolling(pendingKey, poll);

  const request = () => {
    setPhase("sending");
    recheck({ id: runnerId }).then(
      (result) => {
        if (result.ok) {
          setPhase("requested");
          setPendingKey(`${runnerId}:${String(Date.now())}`);
        } else {
          setPhase("failed");
        }
        focusStatusIfLost();
      },
      () => {
        setPhase("failed");
        focusStatusIfLost();
      },
    );
  };

  return {
    statusRef,
    request,
    checking: phase === "sending" || (phase === "requested" && !silent),
    message: recheckMessage(phase, silent),
  };
}

function recheckMessage(phase: RecheckPhase, silent: boolean): RecheckMessage | null {
  switch (phase) {
    case "idle":
    case "sending":
      return null;
    case "requested":
      return silent ? "silent" : "requested";
    case "done":
    case "failed":
      return phase;
  }
}

function FixCallout({
  cause,
  checking,
  onRecheck,
}: {
  cause: "offline" | "assignmentBlocked";
  checking: boolean;
  onRecheck: () => void;
}) {
  const t = useTranslations("runners.panel");
  const code = (chunks: ReactNode) => <code {...stylex.props(styles.code)}>{chunks}</code>;
  return (
    <ProblemCallout
      title={t(`fix.${cause}.title`)}
      steps={(["1", "2", "3"] as const).map((step) =>
        t.rich(`fix.${cause}.steps.${step}`, { code }),
      )}
      actions={
        <Button disabled={checking} onClick={onRecheck}>
          {checking ? t("checking") : t("recheck")}
        </Button>
      }
    >
      {t(`fix.${cause}.body`)}
    </ProblemCallout>
  );
}

function RunList({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.panel");
  const statusName = useStatusName();
  const { elapsed, duration } = useTime();
  const empty = runner.occupying.length === 0 && runner.queued.length === 0;
  return (
    <PanelBlock title={t("runs", { occupied: runner.occupying.length, capacity: runner.capacity })}>
      {empty ? (
        <Text variant="meta">{t("noRuns")}</Text>
      ) : (
        <ol {...stylex.props(styles.list)}>
          {runner.occupying.map((run) => (
            <li key={run.id}>
              <Row
                href={runHref(run.workspace.id, run.id)}
                leading={<StatusPill status={run.state}>{statusName(run.state)}</StatusPill>}
                trailing={elapsed(run.executionMs)}
              >
                <RunLabel ticketKey={run.ticketKey} meta={run.workspace.name} />
              </Row>
            </li>
          ))}
          {runner.queued.map((run) => (
            <li key={run.id}>
              <Row
                href={runHref(run.workspace.id, run.id)}
                leading={<StatusPill status="queued">{statusName("queued")}</StatusPill>}
                trailing={t("queuedFor", { duration: duration(run.waitMs) })}
              >
                <RunLabel ticketKey={run.ticketKey} meta={run.workspace.name} />
              </Row>
            </li>
          ))}
        </ol>
      )}
    </PanelBlock>
  );
}

function RunLabel({ ticketKey, meta }: { ticketKey: string; meta: string }) {
  return (
    <span {...stylex.props(styles.runLabel)}>
      <Text variant="title" numeric>
        {ticketKey}
      </Text>
      <Text variant="meta" truncate>
        {meta}
      </Text>
    </span>
  );
}

function CheckList({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.panel");
  const prerequisiteName = usePrerequisiteName();
  if (!runner.online) {
    return (
      <PanelBlock title={t("checksTitle")}>
        <ul {...stylex.props(styles.list)}>
          <CheckLine state="broken">{t("unreachable")}</CheckLine>
        </ul>
      </PanelBlock>
    );
  }
  const checks = runner.checks;
  if (checks === null || checks.length === 0) {
    return (
      <PanelBlock title={t("checksTitle")}>
        <Text variant="meta">{t("noChecks")}</Text>
      </PanelBlock>
    );
  }
  const passed = checks.filter((check) => check.satisfied === true).length;
  return (
    <PanelBlock title={t("checks", { passed, total: checks.length })}>
      <ul {...stylex.props(styles.list)}>
        {failedChecksFirst(checks).map((check) => (
          <CheckLine
            key={check.id}
            state={checkState(check)}
            hint={check.satisfied === false ? check.hint : null}
          >
            {prerequisiteName(check)}
          </CheckLine>
        ))}
      </ul>
    </PanelBlock>
  );
}

type CheckState = "ok" | "broken" | "unknown";

function checkState(check: RunnerCheckItem): CheckState {
  if (check.satisfied === null) return "unknown";
  return check.satisfied ? "ok" : "broken";
}

function CheckLine({
  state,
  hint = null,
  children,
}: {
  state: CheckState;
  hint?: string | null;
  children: ReactNode;
}) {
  const t = useTranslations("runners.panel.check");
  return (
    <li data-check={state} {...stylex.props(styles.check)}>
      {state === "ok" ? null : <Text variant="meta">{t(state)}</Text>}
      <span {...stylex.props(styles.checkText, styles.wrap)}>
        <Text variant="body" as="span">
          {children}
        </Text>
        {hint === null ? null : (
          <Text variant="meta" mono>
            {hint}
          </Text>
        )}
      </span>
    </li>
  );
}

function LeftWorktrees({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.panel");
  if (runner.leftWorktrees.length === 0) return null;
  return (
    <PanelBlock title={t("leftWorktrees", { count: runner.leftWorktrees.length })}>
      <ul {...stylex.props(styles.list)}>
        {runner.leftWorktrees.map((run) => (
          <li key={run.id}>
            <Row href={runHref(run.workspace.id, run.id)}>
              <RunLabel
                ticketKey={run.ticketKey}
                meta={t("worktreeMeta", {
                  workspace: run.workspace.name,
                  reason: t(`worktree.${run.worktree}`),
                })}
              />
            </Row>
          </li>
        ))}
      </ul>
    </PanelBlock>
  );
}

function runHref(workspaceId: string, runId: string): string {
  return `/runs/${encodeURIComponent(runId)}?${new URLSearchParams({ ws: workspaceId }).toString()}`;
}

const styles = stylex.create({
  rowText: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  rowHead: { display: "flex", alignItems: "baseline", gap: space.s2, minWidth: 0 },
  panelHead: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  statusLine: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  wrap: { minWidth: 0, overflowWrap: "anywhere" },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    margin: 0,
    padding: 0,
    listStyle: "none",
    minWidth: 0,
  },
  runLabel: { display: "flex", alignItems: "baseline", gap: space.s2, minWidth: 0 },
  check: { display: "flex", alignItems: "baseline", gap: space.s2, minWidth: 0 },
  checkText: { display: "flex", flexDirection: "column", gap: space.px2 },
  code: { fontFamily: fonts.mono },
});

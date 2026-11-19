import * as stylex from "@stylexjs/stylex";
import {
  Button,
  buttonStyles,
  CapacityCells,
  DetailPanel,
  MascotMessage,
  PageHeader,
  PanelSection,
  ProblemCallout,
  Row,
  RowTitle,
  SplitView,
  StatusPill,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRows,
  Text,
  textStyles,
  UsageBar,
  UsageMeter,
} from "@ganger/ui";
import { USAGE_HIGH_PERCENT } from "@ganger/core";
import { breakpoints, fonts, size, space } from "@ganger/ui/tokens.stylex";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import { usePrerequisiteName, useUsageNames } from "../labels";
import { useRunnerCheckPolling } from "../settings/settings-screen";
import type { ActionResult } from "../settings/settings-screen";
import { useStatusName } from "../status";
import { failedChecksFirst, problemRunnersFirst, runnerRowStatus } from "@ganger/app/runners/model";
import type {
  ProviderUsageView,
  RunnerCheckItem,
  RunnerUsageView,
  RunnerView,
  RunnersPage,
  UsageWindowView,
} from "@ganger/app/runners/model";

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
        <div {...stylex.props(styles.listColumn)}>
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
            <Table columns="minmax(0, 1fr)">
              <div {...stylex.props(styles.head)}>
                <TableHead>
                  <TableHeader>
                    <span {...stylex.props(styles.rowGrid)}>
                      <span>{t("columns.runner")}</span>
                      <span>{t("columns.slots")}</span>
                      <span>{t("columns.usage")}</span>
                    </span>
                  </TableHeader>
                </TableHead>
              </div>
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
        </div>
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
  const statusName = useStatusName();
  const status = runnerRowStatus(runner);
  return (
    <TableRow value={runner.id} label={runner.name}>
      <TableCell>
        <span id={rowMarkerId(runner.id)} {...stylex.props(styles.rowGrid)}>
          <span {...stylex.props(styles.rowText)}>
            <span {...stylex.props(styles.rowHead)}>
              <StatusPill status={status}>{statusName(status)}</StatusPill>
              <span {...stylex.props(styles.rowName)}>
                <RowTitle>{runner.name}</RowTitle>
              </span>
              {runner.sshTarget === null ? null : (
                <span {...stylex.props(styles.rowHost)}>
                  <Text variant="meta" mono truncate>
                    {runner.sshTarget}
                  </Text>
                </span>
              )}
            </span>
            <Text variant="ui" {...(status === "online" ? {} : { tone: "problem" })} truncate>
              <RowSentence runner={runner} />
            </Text>
          </span>
          <span {...stylex.props(styles.slotsCell)}>
            <RunnerSlots runner={runner} />
          </span>
          <span {...stylex.props(styles.usageCell)}>
            <HighestUsage runner={runner} />
          </span>
        </span>
      </TableCell>
    </TableRow>
  );
}

function RunnerSlots({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners");
  const used = runner.occupying.length;
  return (
    <CapacityCells
      used={used}
      total={runner.capacity}
      label={t("slotsLabel", { used, total: runner.capacity })}
      tone={runnerRowStatus(runner) === "online" ? "progress" : "problem"}
    />
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
      <SlotRuns runner={runner} />
      <ProviderUsage runner={runner} />
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

function SlotRuns({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.panel");
  const statusName = useStatusName();
  const { elapsed, duration } = useTime();
  const empty = runner.occupying.length === 0 && runner.queued.length === 0;
  return (
    <PanelSection title={t("slots")} meta={<RunnerSlots runner={runner} />}>
      {empty ? (
        <Text variant="ui">{t("noRuns")}</Text>
      ) : (
        <ol {...stylex.props(styles.list, styles.rowList)}>
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
    </PanelSection>
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
      <PanelSection title={t("checksTitle")}>
        <ul {...stylex.props(styles.list)}>
          <CheckLine state="broken">{t("unreachable")}</CheckLine>
        </ul>
      </PanelSection>
    );
  }
  const checks = runner.checks;
  if (checks === null || checks.length === 0) {
    return (
      <PanelSection title={t("checksTitle")}>
        <Text variant="ui">{t("noChecks")}</Text>
      </PanelSection>
    );
  }
  const passed = checks.filter((check) => check.satisfied === true).length;
  return (
    <PanelSection
      title={t("checksTitle")}
      meta={t("checksPassed", { passed, total: checks.length })}
    >
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
    </PanelSection>
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
    <li data-check={state} {...stylex.props(styles.labelGrid)}>
      <Text variant="ui" tone={state === "broken" ? "problem" : "muted"}>
        {t(state)}
      </Text>
      <span {...stylex.props(styles.checkText, styles.wrap)}>
        <Text variant="ui" tone="strong" as="span">
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
    <PanelSection
      title={t("leftWorktrees")}
      meta={t("leftWorktreesCount", { count: runner.leftWorktrees.length })}
    >
      <ul {...stylex.props(styles.list, styles.rowList)}>
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
    </PanelSection>
  );
}

function usageTone(window: UsageWindowView): "neutral" | "problem" {
  return window.usedPercent >= USAGE_HIGH_PERCENT ? "problem" : "neutral";
}

function HighestUsage({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.usage");
  const names = useUsageNames();
  const usage = runner.usage;
  if (usage === null) return <Text variant="meta">{t("notRead")}</Text>;
  if (usage.kind === "unreadable") return <Text variant="meta">{t("unreadable")}</Text>;
  if (usage.highest === null) return <Text variant="meta">{t("noWindows")}</Text>;
  const provider = names.provider(usage.highest.provider);
  const window = names.window(usage.highest.window.kind);
  return (
    <UsageMeter
      name={t("name", { provider, window })}
      percent={usage.highest.window.usedPercent}
      label={t("barLabel", { runner: runner.name, provider, window })}
      tone={usageTone(usage.highest.window)}
    />
  );
}

function ProviderUsage({ runner }: { runner: RunnerView }) {
  const t = useTranslations("runners.panel.usage");
  const { ago } = useTime();
  const usage = runner.usage;
  return (
    <PanelSection
      title={t("title")}
      meta={usage === null ? undefined : t("readAgo", { time: ago(usage.readAt, usage.agoMs) })}
    >
      {usage === null ? (
        <Text variant="ui">{t("notRead")}</Text>
      ) : usage.kind === "unreadable" ? (
        <Text variant="ui">{t("unreadable")}</Text>
      ) : (
        <ProviderUsageList runner={runner} usage={usage} />
      )}
      <Text variant="meta">{t("privacy")}</Text>
    </PanelSection>
  );
}

function ProviderUsageList({
  runner,
  usage,
}: {
  runner: RunnerView;
  usage: Extract<RunnerUsageView, { kind: "read" }>;
}) {
  const t = useTranslations("runners.panel.usage");
  const names = useUsageNames();
  const using = usage.providers.filter((p) => p.status === "ok" || p.status === "error");
  const signedOut = usage.providers.filter((p) => p.status === "signed-out");
  const unavailable = usage.providers.filter((p) => p.status === "unavailable");
  const signedOutText =
    signedOut.length === 0
      ? null
      : t("signedOut", {
          providers: signedOut.map((p) => names.provider(p.provider)).join(", "),
        });
  const unavailableText =
    unavailable.length === 0 ? null : t("unavailable", { count: unavailable.length });
  const others =
    signedOutText !== null && unavailableText !== null
      ? t("others", { signedOut: signedOutText, unavailable: unavailableText })
      : (signedOutText ?? unavailableText);
  return (
    <>
      {using.map((provider) => (
        <ProviderWindows
          key={provider.provider}
          runner={runner}
          provider={provider}
          now={usage.now}
        />
      ))}
      {others === null ? null : <Text variant="ui">{others}</Text>}
    </>
  );
}

function ProviderWindows({
  runner,
  provider,
  now,
}: {
  runner: RunnerView;
  provider: ProviderUsageView;
  now: string;
}) {
  const t = useTranslations("runners.panel.usage");
  const tUsage = useTranslations("runners.usage");
  const names = useUsageNames();
  const { stamp } = useTime();
  const name = names.provider(provider.provider);
  return (
    <section aria-label={name} {...stylex.props(styles.provider)}>
      <Text variant="title">{name}</Text>
      {provider.status === "error" ? (
        <Text variant="ui">{t("error")}</Text>
      ) : provider.windows.length === 0 ? (
        <Text variant="ui">{t("noWindows")}</Text>
      ) : (
        <ul {...stylex.props(styles.list, styles.windows)}>
          {provider.windows.map((window) => {
            const windowName = names.window(window.kind);
            const atLimit = isAtLimit(window, now);
            return (
              <li
                key={window.kind}
                data-window={window.kind}
                {...stylex.props(styles.labelGrid, styles.windowGrid)}
              >
                <Text variant="ui">{windowName}</Text>
                <UsageBar
                  percent={window.usedPercent}
                  label={tUsage("barLabel", {
                    runner: runner.name,
                    provider: name,
                    window: windowName,
                  })}
                  tone={usageTone(window)}
                />
                {window.resetsAt === null && !atLimit ? null : (
                  <span {...stylex.props(styles.labelGridRest)}>
                    <Text variant="meta">
                      {window.resetsAt === null
                        ? t("atLimit")
                        : t(atLimit ? "resetsAtLimit" : "resetsAt", {
                            time: stamp(window.resetsAt, now),
                          })}
                    </Text>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function isAtLimit(window: UsageWindowView, now: string): boolean {
  if (window.usedPercent < 100) return false;
  return window.resetsAt === null || Date.parse(window.resetsAt) > Date.parse(now);
}

function runHref(workspaceId: string, runId: string): string {
  return `/runs/${encodeURIComponent(runId)}?${new URLSearchParams({ ws: workspaceId }).toString()}`;
}

const styles = stylex.create({
  listColumn: {
    containerType: "inline-size",
    maxWidth: size.runnerListMaxWidth,
    minWidth: 0,
  },
  rowGrid: {
    display: "grid",
    gridTemplateColumns: {
      default: `minmax(0, 1fr) ${size.slotsColumn} ${size.usageColumn}`,
      [breakpoints.runnerRowTwoColumns]: `${size.slotsColumn} minmax(0, 1fr)`,
      [breakpoints.runnerRowOneColumn]: "minmax(0, 1fr)",
    },
    alignItems: "center",
    columnGap: space.s5,
    rowGap: space.s2,
    minWidth: 0,
  },
  head: {
    display: { default: "block", [breakpoints.runnerRowStacked]: "none" },
  },
  rowText: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    minWidth: 0,
    gridColumn: { default: "auto", [breakpoints.runnerRowStacked]: "1 / -1" },
  },
  rowHead: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s2,
    rowGap: space.px2,
    minWidth: 0,
  },
  rowName: { display: "flex", flexShrink: 0, maxWidth: "100%" },
  rowHost: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  slotsCell: { display: "flex", minWidth: 0 },
  usageCell: { minWidth: 0 },
  panelHead: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  statusLine: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  wrap: { minWidth: 0, overflowWrap: "anywhere" },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    margin: 0,
    padding: 0,
    listStyle: "none",
    minWidth: 0,
  },
  rowList: {
    gap: space.px2,
    marginInline: `calc(${space.s3} * -1)`,
  },
  windows: { gap: space.s3 },
  labelGrid: {
    display: "grid",
    gridTemplateColumns: `${size.panelLabelColumn} minmax(0, 1fr)`,
    alignItems: "baseline",
    columnGap: space.s3,
    rowGap: space.s1,
    minWidth: 0,
  },
  windowGrid: { alignItems: "center" },
  labelGridRest: { gridColumn: "2 / -1", minWidth: 0 },
  runLabel: { display: "flex", alignItems: "baseline", gap: space.s2, minWidth: 0 },
  checkText: { display: "flex", flexDirection: "column", gap: space.px2 },
  code: { fontFamily: fonts.mono },
  provider: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
});

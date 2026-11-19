import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  Card,
  Checklist,
  ChecklistItem,
  Chip,
  DefinitionItem,
  DefinitionList,
  NumberedList,
  PanelBlock,
  RadioGroup,
  RadioOption,
  Text,
  TextLink,
  VisuallyHidden,
  buttonStyles,
  focusStyles,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import type { MouseEvent, ReactNode, RefObject } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { SHARING_SETTINGS_URL } from "@ganger/app/runner-setup/model";
import type { StepProblem, ThisMacStatus, ThisMacStep } from "@ganger/app/runner-setup/model";
import type { RegisterResult } from "@ganger/app/runner-setup/register";
import type { RunnerId } from "@ganger/core";
import { AppFlow } from "./app-flow";
import type { AppFlowActions } from "./app-flow";
import { CommandFlow } from "./command-flow";
import type { CommandFlowActions } from "./command-flow";

export interface RunnerSetupActions extends CommandFlowActions, AppFlowActions {
  thisMacStatus: () => Promise<ThisMacStatus>;
  runThisMacStep: (step: ThisMacStep) => Promise<RegisterResult>;
}

export const SETUP_CHOICES = ["thisMac", "appMac", "commandMac"] as const;
export type SetupChoice = (typeof SETUP_CHOICES)[number];

export interface DirectEntry {
  open: boolean;
  openHref: string;
  closeHref: string;
  onChange: (open: boolean) => void;
}

export const FLOW_STEPS = ["key", "hostKey", "service", "github", "register"] as const;
type FlowStep = (typeof FLOW_STEPS)[number];

export type StepRow =
  | { state: "waiting" | "running" | "done" }
  | { state: "warning" | "failed"; problem: StepProblem | "request-failed"; detail: string | null };

const STATUS_POLL_MS = 2500;
const THIS_MAC_CHIPS = [
  { key: "remoteLogin", you: true },
  { key: "key", you: false },
  { key: "service", you: false },
  { key: "github", you: false },
  { key: "check", you: false },
] as const;

const APP_CHIPS = [
  { key: "remoteLogin", you: true },
  { key: "pressInApp", you: true },
  { key: "keyServiceGithub", you: false },
  { key: "check", you: false },
] as const;

const COMMAND_CHIPS = [
  { key: "remoteLogin", you: true },
  { key: "pasteCommand", you: true },
  { key: "keyServiceGithub", you: false },
  { key: "check", you: false },
] as const;

const DIRECT_CHIPS = [
  { key: "sshTarget", you: true },
  { key: "connect", you: false },
  { key: "findOrca", you: false },
  { key: "githubCheck", you: false },
] as const;

const CHOICE_CHIPS = {
  thisMac: THIS_MAC_CHIPS,
  appMac: APP_CHIPS,
  commandMac: COMMAND_CHIPS,
} as const;

const CHOICE_ABOUT = {
  thisMac: "choose.about",
  appMac: "choose.aboutApp",
  commandMac: "choose.aboutCommand",
} as const;

type ChipStep =
  | (typeof THIS_MAC_CHIPS)[number]
  | (typeof APP_CHIPS)[number]
  | (typeof COMMAND_CHIPS)[number]
  | (typeof DIRECT_CHIPS)[number];

function followLink(event: MouseEvent<HTMLAnchorElement>, go: () => void) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
    return;
  }
  event.preventDefault();
  go();
}

function useFocusOnSwitch(open: boolean) {
  const titleRef = useRef<HTMLSpanElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const shown = useRef(open);
  useEffect(() => {
    if (shown.current === open) return;
    shown.current = open;
    if (open) titleRef.current?.focus();
    else linkRef.current?.focus();
  }, [open]);
  return { titleRef, linkRef };
}

export function canOpenSharingSettings(userAgent: string, hostname: string): boolean {
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  return loopback && /\bElectron\//.test(userAgent);
}

function useCanOpenSharing(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    setCan(canOpenSharingSettings(navigator.userAgent, window.location.hostname));
  }, []);
  return can;
}

type StatusState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; status: ThisMacStatus };

function useThisMacStatus(
  read: RunnerSetupActions["thisMacStatus"],
  pollWhile: (status: ThisMacStatus) => boolean,
): [StatusState, () => void] {
  const [state, setState] = useState<StatusState>({ kind: "loading" });
  const [round, setRound] = useState(0);
  const pollRef = useRef(pollWhile);
  pollRef.current = pollWhile;
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      read().then(
        (status) => {
          if (!alive) return;
          setState({ kind: "ready", status });
          if (pollRef.current(status)) timer = setTimeout(load, STATUS_POLL_MS);
        },
        () => {
          if (alive) setState({ kind: "failed" });
        },
      );
    };
    load();
    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [read, round]);
  return [state, useCallback(() => setRound((r) => r + 1), [])];
}

export function RunnerSetup({
  actions,
  manualForm,
  direct,
  onOpenRunner,
  onRegistered,
  primary,
}: {
  actions: RunnerSetupActions;
  manualForm: ReactNode;
  direct: DirectEntry;
  onOpenRunner?: (runnerId: RunnerId) => void;
  onRegistered?: (runnerId: RunnerId) => void;
  primary: boolean;
}) {
  const [choice, setChoice] = useState<SetupChoice>("thisMac");
  const [flow, setFlow] = useState<SetupChoice | null>(null);
  const otherMac = flow === "commandMac" || flow === "appMac";
  const flowOpen = flow !== null;
  const [status, reloadStatus] = useThisMacStatus(
    actions.thisMacStatus,
    (current) => flow === "thisMac" && !current.remoteLogin,
  );
  const flowTitle = useRef<HTMLSpanElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  const directFocus = useFocusOnSwitch(direct.open);

  useEffect(() => {
    if (flowOpen) {
      opened.current = true;
      flowTitle.current?.focus();
      if (flow === "thisMac") reloadStatus();
    } else if (opened.current) {
      continueRef.current?.focus();
    }
  }, [flowOpen, flow, reloadStatus]);

  if (direct.open) {
    return (
      <DirectEntryView direct={direct} titleRef={directFocus.titleRef} manualForm={manualForm} />
    );
  }

  return (
    <div {...stylex.props(styles.stack)}>
      {otherMac ? null : <ServerFacts status={status} onRetry={reloadStatus} />}
      {flow === "appMac" ? (
        <AppFlow
          actions={actions}
          titleRef={flowTitle}
          onBack={() => setFlow(null)}
          primary={primary}
          {...(onOpenRunner === undefined ? {} : { onOpenRunner })}
          {...(onRegistered === undefined ? {} : { onRegistered })}
        />
      ) : flow === "commandMac" ? (
        <CommandFlow
          actions={actions}
          titleRef={flowTitle}
          onBack={() => setFlow(null)}
          primary={primary}
          {...(onOpenRunner === undefined ? {} : { onOpenRunner })}
          {...(onRegistered === undefined ? {} : { onRegistered })}
        />
      ) : flow === "thisMac" && status.kind === "ready" ? (
        <ThisMacFlow
          status={status.status}
          actions={actions}
          titleRef={flowTitle}
          onBack={() => setFlow(null)}
          onLookAgain={reloadStatus}
          primary={primary}
          {...(onOpenRunner === undefined ? {} : { onOpenRunner })}
          {...(onRegistered === undefined ? {} : { onRegistered })}
        />
      ) : (
        <Chooser
          name={status.kind === "ready" ? status.status.name : null}
          ready={status.kind === "ready" || choice !== "thisMac"}
          choice={choice}
          onChoose={setChoice}
          continueRef={continueRef}
          primary={primary}
          onContinue={() => setFlow(choice)}
          direct={direct}
          directLinkRef={directFocus.linkRef}
        />
      )}
    </div>
  );
}

function DirectEntryView({
  direct,
  titleRef,
  manualForm,
}: {
  direct: DirectEntry;
  titleRef: RefObject<HTMLSpanElement | null>;
  manualForm: ReactNode;
}) {
  const t = useTranslations("runnerSetup");
  return (
    <div {...stylex.props(styles.stack)}>
      <span>
        <TextLink
          href={direct.closeHref}
          tone="quiet"
          onClick={(event) => followLink(event, () => direct.onChange(false))}
        >
          <span aria-hidden>{"← "}</span>
          {t("direct.back")}
        </TextLink>
      </span>
      <div {...stylex.props(styles.group)}>
        <Text variant="title">
          <span ref={titleRef} tabIndex={-1} {...stylex.props(focusStyles.ring)}>
            {t("direct.title")}
          </span>
        </Text>
        <Text variant="body">{t("direct.body")}</Text>
      </div>
      <Card label={t("direct.title")}>
        <div {...stylex.props(styles.stack)}>
          <StepChips steps={DIRECT_CHIPS} label={t("direct.stepsLabel")} />
          {manualForm}
        </div>
      </Card>
    </div>
  );
}

function ServerFacts({ status, onRetry }: { status: StatusState; onRetry: () => void }) {
  const t = useTranslations("runnerSetup.server");
  return (
    <Card label={t("title")}>
      <PanelBlock title={t("title")}>
        {status.kind === "loading" ? (
          <Text variant="meta" role="status">
            {t("loading")}
          </Text>
        ) : status.kind === "failed" ? (
          <div {...stylex.props(styles.stack)}>
            <Text variant="ui" as="p" tone="problem" role="alert">
              {t("failed")}
            </Text>
            <Actions>
              <Button onClick={onRetry}>{t("retry")}</Button>
            </Actions>
          </div>
        ) : (
          <DefinitionList>
            <DefinitionItem label={t("name")}>{status.status.name}</DefinitionItem>
            <DefinitionItem label={t("orca")} empty={status.status.orcaPath === null}>
              {status.status.orcaPath === null ? (
                t("orcaMissing")
              ) : (
                <span {...stylex.props(styles.rowText)}>
                  {t("orcaFound")}
                  <Text variant="meta" mono>
                    {status.status.orcaPath}
                  </Text>
                </span>
              )}
            </DefinitionItem>
            <DefinitionItem label={t("remoteLogin")} empty={!status.status.remoteLogin}>
              {status.status.remoteLogin ? t("remoteLoginOn") : t("remoteLoginOff")}
            </DefinitionItem>
            <DefinitionItem label={t("tailscale")} empty={status.status.tailscale !== "connected"}>
              {status.status.tailscale === "connected"
                ? t("tailscaleConnected")
                : status.status.tailscale === "disconnected"
                  ? t("tailscaleDisconnected")
                  : t("tailscaleMissing")}
            </DefinitionItem>
          </DefinitionList>
        )}
      </PanelBlock>
    </Card>
  );
}

function Chooser({
  name,
  ready,
  choice,
  onChoose,
  continueRef,
  primary,
  onContinue,
  direct,
  directLinkRef,
}: {
  name: string | null;
  ready: boolean;
  choice: SetupChoice;
  onChoose: (choice: SetupChoice) => void;
  continueRef: RefObject<HTMLButtonElement | null>;
  primary: boolean;
  onContinue: () => void;
  direct: DirectEntry;
  directLinkRef: RefObject<HTMLAnchorElement | null>;
}) {
  const t = useTranslations("runnerSetup");
  const questionId = useId();
  return (
    <div {...stylex.props(styles.group)}>
      <div {...stylex.props(styles.questionRow)}>
        <Text variant="title" id={questionId}>
          {t("choose.question")}
        </Text>
        <span aria-hidden {...stylex.props(styles.inline)}>
          <Chip tone="accent">{t("choose.you")}</Chip>
          <Chip>{t("choose.ganger")}</Chip>
        </span>
      </div>
      <RadioGroup labelledBy={questionId}>
        {SETUP_CHOICES.map((option) => {
          const chosen = option === choice;
          return (
            <RadioOption
              key={option}
              name="runner-setup"
              value={option}
              checked={chosen}
              onCheck={() => onChoose(option)}
            >
              <span {...stylex.props(styles.optionBody)}>
                <Text variant="ui" tone="strong">
                  {option === "thisMac"
                    ? name === null
                      ? t("choose.thisMacFallback")
                      : t("choose.thisMac", { name })
                    : t(`choose.${option}`)}
                </Text>
                <Text variant="meta">{t(`choose.${option}Body`)}</Text>
                {chosen ? (
                  <span {...stylex.props(styles.chipRow)}>
                    <StepChips steps={CHOICE_CHIPS[option]} label={t("choose.stepsLabel")} />
                    <Text variant="meta">{t(CHOICE_ABOUT[option])}</Text>
                  </span>
                ) : null}
              </span>
            </RadioOption>
          );
        })}
      </RadioGroup>
      <div {...stylex.props(styles.actionRow)}>
        <Button
          ref={continueRef}
          variant={primary ? "primary" : "secondary"}
          disabled={!ready}
          onClick={onContinue}
        >
          {t("choose.continue")}
        </Button>
        <span {...stylex.props(styles.inline)}>
          <Text variant="meta">{t("choose.directHint")}</Text>
          <TextLink
            ref={directLinkRef}
            href={direct.openHref}
            tone="action"
            onClick={(event) => followLink(event, () => direct.onChange(true))}
          >
            {t("choose.directLink")}
            <span aria-hidden>→</span>
          </TextLink>
        </span>
      </div>
    </div>
  );
}

function StepChips({ steps, label }: { steps: readonly ChipStep[]; label: string }) {
  const t = useTranslations("runnerSetup.chips");
  return (
    <ol aria-label={label} {...stylex.props(styles.chips)}>
      {steps.map((step, i) => {
        const name = t(step.key);
        return (
          <li key={step.key} {...stylex.props(styles.chipItem)}>
            {i === 0 ? null : (
              <span aria-hidden {...stylex.props(styles.arrow)}>
                <Text variant="meta">→</Text>
              </span>
            )}
            {step.you ? (
              <Chip tone="accent">{t("you", { step: name })}</Chip>
            ) : (
              <Chip>
                <VisuallyHidden>{t("ganger", { step: name })}</VisuallyHidden>
                <span aria-hidden>{name}</span>
              </Chip>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function initialRows(): Record<FlowStep, StepRow> {
  return {
    key: { state: "waiting" },
    hostKey: { state: "waiting" },
    service: { state: "waiting" },
    github: { state: "waiting" },
    register: { state: "waiting" },
  };
}

function ThisMacFlow({
  status,
  actions,
  titleRef,
  onBack,
  onLookAgain,
  primary,
  onOpenRunner,
  onRegistered,
}: {
  status: ThisMacStatus;
  actions: RunnerSetupActions;
  titleRef: RefObject<HTMLSpanElement | null>;
  onBack: () => void;
  onLookAgain: () => void;
  primary: boolean;
  onOpenRunner?: (runnerId: RunnerId) => void;
  onRegistered?: (runnerId: RunnerId) => void;
}) {
  const t = useTranslations("runnerSetup.thisMac");
  const [rows, setRows] = useState(initialRows);
  const [started, setStarted] = useState(false);
  const [registeredId, setRegisteredId] = useState<RunnerId | null>(null);
  const registered = registeredId !== null;
  const openRunnerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (registeredId !== null) openRunnerRef.current?.focus();
  }, [registeredId]);
  const running = useRef(false);
  const ready = status.remoteLogin && status.orcaPath !== null;

  const runFrom = useCallback(
    async (start: number) => {
      if (running.current) return;
      running.current = true;
      setStarted(true);
      try {
        for (const step of FLOW_STEPS.slice(start)) {
          setRows((all) => ({ ...all, [step]: { state: "running" } }));
          let outcome: RegisterResult;
          try {
            outcome = await actions.runThisMacStep(step);
          } catch {
            setRows((all) => ({
              ...all,
              [step]: { state: "failed", problem: "request-failed", detail: null },
            }));
            return;
          }
          const result = outcome.result;
          setRows((all) => ({
            ...all,
            [step]:
              result.outcome === "done"
                ? { state: "done" }
                : { state: result.outcome, problem: result.problem, detail: result.detail },
          }));
          if (result.outcome === "failed") return;
          if (step === "register" && outcome.runnerId !== null) {
            setRegisteredId(outcome.runnerId);
            onRegistered?.(outcome.runnerId);
          }
        }
      } finally {
        running.current = false;
      }
    },
    [actions, onRegistered],
  );

  useEffect(() => {
    if (ready && !started) void runFrom(0);
  }, [ready, started, runFrom]);

  const failedAt = FLOW_STEPS.findIndex((step) => rows[step].state === "failed");

  return (
    <Card label={t("title")}>
      <div {...stylex.props(styles.stack)}>
        <Text variant="title">
          <span ref={titleRef} tabIndex={-1} {...stylex.props(focusStyles.ring)}>
            {t("title")}
          </span>
        </Text>
        <Checklist label={t("readyLabel")}>
          <ChecklistItem
            done={status.orcaPath !== null}
            label={status.orcaPath === null ? t("state.failed") : t("state.done")}
          >
            {status.orcaPath === null ? t("orcaMissing") : t("orcaFound")}
            {status.orcaPath === null ? null : (
              <Text variant="meta" mono truncate>
                {status.orcaPath}
              </Text>
            )}
          </ChecklistItem>
          <ChecklistItem
            done={status.remoteLogin}
            label={status.remoteLogin ? t("state.done") : t("state.waiting")}
          >
            {status.remoteLogin ? t("remoteLoginOn") : t("remoteLoginTitle")}
          </ChecklistItem>
        </Checklist>
        {status.orcaPath === null ? (
          <div {...stylex.props(styles.stack)}>
            <Text variant="body">{t("orcaMissingBody")}</Text>
            <Actions>
              <Button onClick={onLookAgain}>{t("lookAgain")}</Button>
            </Actions>
          </div>
        ) : status.remoteLogin ? null : (
          <RemoteLoginGuide account={status.account} primary={primary} />
        )}
        <StepRows rows={rows} />
        {failedAt === -1 ? null : (
          <Actions>
            <Button
              variant={primary ? "primary" : "secondary"}
              onClick={() => {
                titleRef.current?.focus();
                void runFrom(failedAt);
              }}
            >
              {t("retry")}
            </Button>
          </Actions>
        )}
        <PanelBlock title={t("settingsTitle")}>
          <DefinitionList>
            <DefinitionItem label={t("name")}>{status.name}</DefinitionItem>
            <DefinitionItem label={t("capacity")}>{t("capacityValue")}</DefinitionItem>
            <DefinitionItem label={t("sshTarget")}>
              <Text variant="meta" mono>
                {`${status.account}@localhost`}
              </Text>
            </DefinitionItem>
          </DefinitionList>
        </PanelBlock>
        <Text variant="ui" as="p" role="status">
          {registered
            ? onOpenRunner === undefined
              ? t("registered", { name: status.name })
              : t("registeredHere", { name: status.name })
            : failedAt === -1
              ? ""
              : t("stopped", { step: t(`step.${FLOW_STEPS[failedAt] ?? "key"}`) })}
        </Text>
        <Actions>
          {registeredId !== null && onOpenRunner !== undefined ? (
            <Button
              ref={openRunnerRef}
              variant={primary ? "primary" : "secondary"}
              onClick={() => onOpenRunner(registeredId)}
            >
              {t("openRunner", { name: status.name })}
            </Button>
          ) : null}
          <Button onClick={onBack} disabled={started && !registered && failedAt === -1}>
            {t("back")}
          </Button>
        </Actions>
      </div>
    </Card>
  );
}

function RemoteLoginGuide({ account, primary }: { account: string; primary: boolean }) {
  const t = useTranslations("runnerSetup.thisMac");
  const canOpen = useCanOpenSharing();
  return (
    <div {...stylex.props(styles.stack)}>
      <Text variant="body">{t("remoteLoginBody")}</Text>
      <NumberedList
        items={[
          canOpen ? t("remoteLoginOpen") : t("remoteLoginOpenHere"),
          t("remoteLoginTurnOn"),
          t("remoteLoginUser", { account }),
        ]}
      />
      {canOpen ? (
        <Actions>
          <a
            href={SHARING_SETTINGS_URL}
            target="_blank"
            rel="noreferrer"
            data-variant={primary ? "primary" : "secondary"}
            {...stylex.props(...buttonStyles(primary ? "primary" : "secondary"))}
          >
            {t("openSharing")}
          </a>
        </Actions>
      ) : null}
      <Text variant="meta" role="status">
        {t("waiting")}
      </Text>
    </div>
  );
}

function StepRows({ rows }: { rows: Record<FlowStep, StepRow> }) {
  const t = useTranslations("runnerSetup.thisMac");
  return (
    <Checklist label={t("stepsLabel")}>
      {FLOW_STEPS.map((step) => {
        const row = rows[step];
        return (
          <ChecklistItem
            key={step}
            done={row.state === "done"}
            running={row.state === "running"}
            label={t(`state.${row.state}`)}
          >
            <span {...stylex.props(styles.rowText)}>
              <span {...stylex.props(styles.inline)}>
                <Text variant="ui">{t(`step.${step}`)}</Text>
                {row.state === "running" || row.state === "warning" ? (
                  <Text variant="meta">{t(`state.${row.state}`)}</Text>
                ) : null}
              </span>
              {row.state === "warning" || row.state === "failed" ? (
                <StepProblemText row={row} />
              ) : null}
            </span>
          </ChecklistItem>
        );
      })}
    </Checklist>
  );
}

function StepProblemText({
  row,
}: {
  row: {
    state: "warning" | "failed";
    problem: StepProblem | "request-failed";
    detail: string | null;
  };
}) {
  const t = useTranslations("runnerSetup.thisMac");
  return (
    <>
      <Text variant="meta" {...(row.state === "failed" ? { tone: "problem" as const } : {})}>
        {row.problem === "request-failed" ? t("requestFailed") : t(`problem.${row.problem}`)}
      </Text>
      {row.detail === null ? null : (
        <Text variant="meta" mono>
          {row.detail}
        </Text>
      )}
    </>
  );
}

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  group: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  questionRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  inline: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  optionBody: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s3,
    paddingTop: space.s2,
  },
  chips: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s1,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  chipItem: { display: "inline-flex", alignItems: "center", gap: space.s1 },
  arrow: { display: "inline-flex" },
  actionRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  rowText: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
});

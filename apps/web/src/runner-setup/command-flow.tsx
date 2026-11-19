import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  Card,
  CodeBlock,
  DefinitionItem,
  DefinitionList,
  Disclosure,
  Field,
  Input,
  NumberedList,
  PanelBlock,
  SegmentedTabs,
  Text,
  TextLink,
  VisuallyHidden,
  focusStyles,
  showToast,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type {
  EnrolledRunner,
  EnrollmentView,
  StartEnrollmentResult,
} from "@ganger/app/runner-setup/enrollment";
import type { RunnerId } from "@ganger/core";
import { browserClipboard, copyText } from "../settings/clipboard";

export type WebAddressResult =
  | { ok: true }
  | { ok: false; reason: "invalid-web-address" | "invalid-webhook-address" | "locks-out" };

export interface CommandFlowActions {
  startEnrollment: (replacing?: string) => Promise<StartEnrollmentResult>;
  saveWebAddress: (webAddress: string) => Promise<WebAddressResult>;
  enrollment: (id: string) => Promise<EnrollmentView>;
  cancelEnrollment: (id: string) => Promise<void>;
}

const POLL_MS = 2000;
const TICK_MS = 1000;
const WHAT_ITEMS = ["remoteLogin", "key", "service", "github", "report"] as const;
const HELP_ITEMS = ["unreachable", "orca", "other"] as const;

type Issued = Extract<StartEnrollmentResult, { ok: true }>;
type Unavailable = Extract<StartEnrollmentResult, { ok: false }>["reason"] | "request-failed";

type FlowState =
  | { kind: "starting" }
  | { kind: "unavailable"; reason: Unavailable }
  | { kind: "issued"; issued: Issued; deadline: number; view: EnrollmentView };

export function remainingLabel(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function useEnrollment(actions: CommandFlowActions) {
  const [state, setState] = useState<FlowState>({ kind: "starting" });
  const [renewed, setRenewed] = useState(0);
  const currentId = useRef<string | null>(null);
  const request = useRef(0);

  const start = useCallback(async () => {
    const mine = ++request.current;
    const replacing = currentId.current ?? undefined;
    currentId.current = null;
    setState({ kind: "starting" });
    let result: StartEnrollmentResult;
    try {
      result = await actions.startEnrollment(replacing);
    } catch {
      if (mine === request.current) setState({ kind: "unavailable", reason: "request-failed" });
      return;
    }
    if (mine !== request.current) {
      if (result.ok) void actions.cancelEnrollment(result.id).catch(() => undefined);
      return;
    }
    if (!result.ok) {
      setState({ kind: "unavailable", reason: result.reason });
      return;
    }
    currentId.current = result.id;
    setState({
      kind: "issued",
      issued: result,
      deadline: Date.now() + result.expiresInMs,
      view: { state: "waiting", expiresInMs: result.expiresInMs },
    });
    if (replacing !== undefined) setRenewed((n) => n + 1);
  }, [actions]);

  useEffect(() => {
    void start();
    return () => {
      request.current += 1;
      const id = currentId.current;
      currentId.current = null;
      if (id !== null) void actions.cancelEnrollment(id).catch(() => undefined);
    };
  }, [actions, start]);

  const id = state.kind === "issued" ? state.issued.id : null;
  const waiting = state.kind === "issued" && state.view.state === "waiting";
  useEffect(() => {
    if (id === null || !waiting) return;
    let alive = true;
    const timer = setInterval(() => {
      actions.enrollment(id).then(
        (view) => {
          if (!alive) return;
          setState((current) =>
            current.kind === "issued" && current.issued.id === id ? { ...current, view } : current,
          );
        },
        () => undefined,
      );
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [actions, id, waiting]);

  return { state, start, renewed };
}

export function CommandFlow({
  actions,
  titleRef,
  onBack,
  primary,
  onOpenRunner,
  onRegistered,
}: {
  actions: CommandFlowActions;
  titleRef: RefObject<HTMLSpanElement | null>;
  onBack: () => void;
  primary: boolean;
  onOpenRunner?: (runnerId: RunnerId) => void;
  onRegistered?: (runnerId: RunnerId) => void;
}) {
  const t = useTranslations("runnerSetup.command");
  const { state, start, renewed } = useEnrollment(actions);
  const waiting = state.kind === "issued" && state.view.state === "waiting";
  const now = useNow(waiting);
  const left = state.kind === "issued" ? state.deadline - now : 0;
  const expired =
    state.kind === "issued" &&
    (state.view.state === "expired" ||
      state.view.state === "unknown" ||
      (state.view.state === "waiting" && left <= 0));
  const registered =
    state.kind === "issued" && state.view.state === "registered" ? state.view.runner : null;
  const failed = state.kind === "issued" && state.view.state === "failed";
  const reported = useRef<string | null>(null);
  const openRunnerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (registered === null || reported.current === registered.id) return;
    reported.current = registered.id;
    onRegistered?.(registered.id);
    openRunnerRef.current?.focus();
  }, [registered, onRegistered]);

  return (
    <Card label={t("title")}>
      <div {...stylex.props(styles.stack)}>
        <div {...stylex.props(styles.group)}>
          <Text variant="title" as="h2">
            <span ref={titleRef} tabIndex={-1} {...stylex.props(focusStyles.ring)}>
              {t("title")}
            </span>
          </Text>
          {registered === null ? <Text variant="body">{t("body")}</Text> : null}
          <VisuallyHidden>
            <span role="alert">
              {state.kind === "unavailable" && state.reason !== "no-web-address"
                ? t(`unavailable.${state.reason}`)
                : ""}
            </span>
          </VisuallyHidden>
        </div>
        {registered !== null ? (
          <Registered
            runner={registered}
            primary={primary}
            openRunnerRef={openRunnerRef}
            onBack={onBack}
            {...(onOpenRunner === undefined ? {} : { onOpenRunner })}
          />
        ) : state.kind === "unavailable" ? (
          <UnavailableNotice
            reason={state.reason}
            actions={actions}
            onRetry={() => {
              titleRef.current?.focus();
              void start();
            }}
          />
        ) : (
          <>
            <Steps
              issued={state.kind === "issued" ? state.issued : null}
              stopped={expired || failed}
              left={left}
            />
            <WaitingRow
              state={state}
              expired={expired}
              renewed={renewed}
              primary={primary}
              onNewCommand={() => {
                titleRef.current?.focus();
                void start();
              }}
            />
            <Disclosure summary={t("whatTitle")}>
              <ul {...stylex.props(styles.bullets)}>
                {WHAT_ITEMS.map((item) => (
                  <li key={item}>
                    <Text variant="ui">{t(`what.${item}`)}</Text>
                  </li>
                ))}
              </ul>
              <Text variant="meta">{t("whatNote")}</Text>
            </Disclosure>
            <PanelBlock title={t("helpTitle")}>
              <ul {...stylex.props(styles.bullets)}>
                {HELP_ITEMS.map((item) => (
                  <li key={item}>
                    <Text variant="meta">{t(`help.${item}`)}</Text>
                  </li>
                ))}
              </ul>
            </PanelBlock>
          </>
        )}
        {registered === null ? (
          <Actions>
            <Button onClick={onBack}>{t("back")}</Button>
          </Actions>
        ) : null}
      </div>
    </Card>
  );
}

function Steps({
  issued,
  stopped,
  left,
}: {
  issued: Issued | null;
  stopped: boolean;
  left: number;
}) {
  const t = useTranslations("runnerSetup.command");
  return (
    <section aria-label={t("stepsLabel")} {...stylex.props(styles.stack)}>
      <NumberedList
        items={[
          <span key="remote" {...stylex.props(styles.stepBody)}>
            <Text variant="ui" tone="strong">
              {t("remoteLoginTitle")}
            </Text>
            <Text variant="meta">{t("remoteLoginBody")}</Text>
          </span>,
          <span key="paste" {...stylex.props(styles.stepBody)}>
            <Text variant="ui" tone="strong">
              {t("pasteTitle")}
            </Text>
            {issued === null ? (
              <Text variant="meta" role="status">
                {t("starting")}
              </Text>
            ) : stopped ? (
              <Text variant="meta">{t("expiredHere")}</Text>
            ) : null}
          </span>,
        ]}
      />
      {issued === null || stopped ? null : <CommandBox issued={issued} left={left} />}
    </section>
  );
}

type CommandForm = "oneLine" | "reviewFirst";

function CommandBox({ issued, left }: { issued: Issued; left: number }) {
  const t = useTranslations("runnerSetup.command");
  const [form, setForm] = useState<CommandForm>("oneLine");
  const command = form === "reviewFirst" ? issued.reviewCommand : issued.command;
  const copy = () => {
    void copyText(command, browserClipboard()).then((copied) =>
      showToast(copied ? t("copied") : t("copyFailed")),
    );
  };
  return (
    <span {...stylex.props(styles.group)}>
      <SegmentedTabs<CommandForm>
        value={form}
        onValueChange={setForm}
        label={t("formLabel")}
        items={[
          { value: "oneLine", label: t("oneLine") },
          { value: "reviewFirst", label: t("reviewFirst") },
        ]}
      />
      <CodeBlock
        tone="command"
        label={form === "reviewFirst" ? t("reviewCommandLabel") : t("commandLabel")}
      >
        {command}
      </CodeBlock>
      <span {...stylex.props(styles.linkRow)}>
        <span {...stylex.props(styles.inline)}>
          <Button onClick={copy}>{t("copy")}</Button>
          <TextLink href={issued.scriptPath} external tone="action">
            {t("viewScript")}
          </TextLink>
        </span>
        <Text variant="meta" numeric>
          {t("expiresIn", { time: remainingLabel(left) })}
        </Text>
      </span>
    </span>
  );
}

function WaitingRow({
  state,
  expired,
  renewed,
  primary,
  onNewCommand,
}: {
  state: FlowState;
  expired: boolean;
  renewed: number;
  primary: boolean;
  onNewCommand: () => void;
}) {
  const t = useTranslations("runnerSetup.command");
  const tp = useTranslations("runnerSetup.command.problem");
  const failed = state.kind === "issued" && state.view.state === "failed" ? state.view : null;
  const waiting = state.kind === "issued" && !expired && failed === null;
  const stopped = expired || failed !== null;
  return (
    <div {...stylex.props(styles.waitingRow)}>
      <span {...stylex.props(styles.waitingText)}>
        <Text variant="ui" as="p" role="status" {...(failed === null ? {} : { tone: "problem" })}>
          {failed !== null
            ? t("failed", { problem: tp(failed.problem) })
            : expired
              ? t("expired")
              : waiting
                ? renewed > 0
                  ? t("newCommandReady")
                  : t("waiting")
                : ""}
        </Text>
        {failed?.detail == null ? null : (
          <Text variant="meta" mono wrap="anywhere">
            {failed.detail}
          </Text>
        )}
      </span>
      {stopped ? (
        <Button variant={primary ? "primary" : "secondary"} onClick={onNewCommand}>
          {t("newCommand")}
        </Button>
      ) : null}
    </div>
  );
}

function UnavailableNotice({
  reason,
  actions,
  onRetry,
}: {
  reason: Unavailable;
  actions: CommandFlowActions;
  onRetry: () => void;
}) {
  const t = useTranslations("runnerSetup.command");
  if (reason === "no-web-address") {
    return <WebAddressForm actions={actions} onSaved={onRetry} />;
  }
  return (
    <div {...stylex.props(styles.group)}>
      <Text variant="ui" as="p" tone="problem">
        {t(`unavailable.${reason}`)}
      </Text>
      <Actions>
        <Button onClick={onRetry}>{t("retry")}</Button>
      </Actions>
    </div>
  );
}

function WebAddressForm({
  actions,
  onSaved,
}: {
  actions: CommandFlowActions;
  onSaved: () => void;
}) {
  const t = useTranslations("runnerSetup.command.address");
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fail = (message: string) => {
    setError(message);
    inputRef.current?.focus();
  };
  return (
    <form
      {...stylex.props(styles.group)}
      onSubmit={(event) => {
        event.preventDefault();
        if (sending) return;
        if (value.trim() === "") {
          fail(t("error.empty"));
          return;
        }
        setSending(true);
        setError(null);
        actions.saveWebAddress(value.trim()).then(
          (result) => {
            setSending(false);
            if (result.ok) onSaved();
            else fail(t(`error.${result.reason}`));
          },
          () => {
            setSending(false);
            fail(t("error.request-failed"));
          },
        );
      }}
    >
      <Text variant="body">{t("body")}</Text>
      <Field label={t("label")} description={t("description")} error={error ?? undefined}>
        <Input
          ref={inputRef}
          name="webAddress"
          type="url"
          value={value}
          onValueChange={setValue}
          placeholder={t("placeholder")}
          autoComplete="off"
          mono
        />
      </Field>
      <Actions>
        <Button type="submit" disabled={sending}>
          {sending ? t("saving") : t("save")}
        </Button>
      </Actions>
    </form>
  );
}

function Registered({
  runner,
  primary,
  openRunnerRef,
  onOpenRunner,
  onBack,
}: {
  runner: EnrolledRunner;
  primary: boolean;
  openRunnerRef: RefObject<HTMLButtonElement | null>;
  onOpenRunner?: (runnerId: RunnerId) => void;
  onBack: () => void;
}) {
  const t = useTranslations("runnerSetup.command");
  return (
    <div {...stylex.props(styles.stack)}>
      <Text variant="ui" as="p" role="status">
        {onOpenRunner === undefined
          ? t("registered", { name: runner.name })
          : t("registeredHere", { name: runner.name })}
      </Text>
      <DefinitionList>
        <DefinitionItem label={t("sshTarget")}>
          <Text variant="meta" mono wrap="anywhere">
            {runner.sshTarget}
          </Text>
        </DefinitionItem>
        <DefinitionItem label={t("orcaPath")}>
          <Text variant="meta" mono wrap="anywhere">
            {runner.orcaPath}
          </Text>
        </DefinitionItem>
        <DefinitionItem label={t("capacity")}>{t("capacityValue")}</DefinitionItem>
      </DefinitionList>
      {runner.github === "done" ? null : <Text variant="meta">{t(`github.${runner.github}`)}</Text>}
      <Actions>
        {onOpenRunner === undefined ? null : (
          <Button
            ref={openRunnerRef}
            variant={primary ? "primary" : "secondary"}
            onClick={() => onOpenRunner(runner.id)}
          >
            {t("openRunner", { name: runner.name })}
          </Button>
        )}
        <Button onClick={onBack}>{t("back")}</Button>
      </Actions>
    </div>
  );
}

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  group: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  stepBody: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  inline: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
  linkRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
  },
  waitingRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  waitingText: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    minWidth: 0,
    flexGrow: 1,
  },
  bullets: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    margin: 0,
    paddingInlineStart: space.s5,
    listStyleType: "disc",
  },
});

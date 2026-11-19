import * as stylex from "@stylexjs/stylex";
import { Actions, Button, DefinitionItem, DefinitionList, Field, Input, Text } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { EnrolledRunner, EnrollmentView } from "@ganger/app/runner-setup/enrollment";
import type { RunnerId } from "@ganger/core";

export type WebAddressResult =
  | { ok: true }
  | { ok: false; reason: "invalid-web-address" | "invalid-webhook-address" | "locks-out" };

export type EnrollmentUnavailable = "no-web-address" | "no-home" | "keygen-failed";

export interface EnrollmentActions {
  saveWebAddress: (webAddress: string) => Promise<WebAddressResult>;
  enrollment: (id: string) => Promise<EnrollmentView>;
  cancelEnrollment: (id: string) => Promise<void>;
}

interface Started {
  ok: true;
  id: string;
  expiresInMs: number;
}

export type StartResult<I extends Started> = I | { ok: false; reason: EnrollmentUnavailable };

export type Unavailable = EnrollmentUnavailable | "request-failed";

export type FlowState<I extends Started> =
  | { kind: "starting" }
  | { kind: "unavailable"; reason: Unavailable }
  | { kind: "issued"; issued: I; deadline: number; view: EnrollmentView };

const POLL_MS = 2000;
const TICK_MS = 1000;

export function remainingLabel(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

const isLive = (view: EnrollmentView) => view.state === "waiting" || view.state === "preparing";

export function useEnrollment<I extends Started>(
  actions: EnrollmentActions,
  begin: (replacing?: string) => Promise<StartResult<I>>,
) {
  const [state, setState] = useState<FlowState<I>>({ kind: "starting" });
  const [renewed, setRenewed] = useState(0);
  const currentId = useRef<string | null>(null);
  const request = useRef(0);

  const start = useCallback(async () => {
    const mine = ++request.current;
    const replacing = currentId.current ?? undefined;
    currentId.current = null;
    setState({ kind: "starting" });
    let result: StartResult<I>;
    try {
      result = await begin(replacing);
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
  }, [actions, begin]);

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
  const live = state.kind === "issued" && isLive(state.view);
  useEffect(() => {
    if (id === null || !live) return;
    let alive = true;
    const timer = setInterval(() => {
      actions.enrollment(id).then(
        (view) => {
          if (!alive) return;
          setState((current) => {
            if (current.kind !== "issued" || current.issued.id !== id) return current;
            const deadline =
              view.state === "preparing" && current.view.state !== "preparing"
                ? Date.now() + view.expiresInMs
                : current.deadline;
            return { ...current, view, deadline };
          });
        },
        () => undefined,
      );
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [actions, id, live]);

  return { state, start, renewed };
}

export function enrollmentStatus<I extends Started>(state: FlowState<I>, now: number) {
  const left = state.kind === "issued" ? state.deadline - now : 0;
  const view = state.kind === "issued" ? state.view : null;
  const expired =
    view !== null &&
    (view.state === "expired" || view.state === "unknown" || (isLive(view) && left <= 0));
  return {
    left,
    expired,
    preparing: !expired && view?.state === "preparing",
    registered: view?.state === "registered" ? view.runner : null,
    failed: view?.state === "failed" ? view : null,
  };
}

export function useRegisteredFocus(
  registered: EnrolledRunner | null,
  onRegistered: ((runnerId: RunnerId) => void) | undefined,
) {
  const reported = useRef<string | null>(null);
  const openRunnerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (registered === null || reported.current === registered.id) return;
    reported.current = registered.id;
    onRegistered?.(registered.id);
    openRunnerRef.current?.focus();
  }, [registered, onRegistered]);
  return openRunnerRef;
}

export function WaitingRow({
  message,
  detail,
  problem,
  retryLabel,
  primary,
  onRetry,
}: {
  message: string;
  detail: string | null;
  problem: boolean;
  retryLabel: string | null;
  primary: boolean;
  onRetry: () => void;
}) {
  return (
    <div {...stylex.props(styles.waitingRow)}>
      <span {...stylex.props(styles.waitingText)}>
        <Text variant="ui" as="p" role="status" {...(problem ? { tone: "problem" as const } : {})}>
          {message}
        </Text>
        {detail === null ? null : (
          <Text variant="meta" mono wrap="anywhere">
            {detail}
          </Text>
        )}
      </span>
      {retryLabel === null ? null : (
        <Button variant={primary ? "primary" : "secondary"} onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

export function UnavailableNotice({
  reason,
  actions,
  saveLabel,
  onRetry,
}: {
  reason: Unavailable;
  actions: EnrollmentActions;
  saveLabel: string;
  onRetry: () => void;
}) {
  const t = useTranslations("runnerSetup.command");
  if (reason === "no-web-address") {
    return <WebAddressForm actions={actions} saveLabel={saveLabel} onSaved={onRetry} />;
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
  saveLabel,
  onSaved,
}: {
  actions: EnrollmentActions;
  saveLabel: string;
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
          {sending ? t("saving") : saveLabel}
        </Button>
      </Actions>
    </form>
  );
}

export function Registered({
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
        <DefinitionItem label={t("capacity")}>{runner.capacity}</DefinitionItem>
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
});

import * as stylex from "@stylexjs/stylex";
import {
  Button,
  CodeBlock,
  DefinitionItem,
  DefinitionList,
  Field,
  Input,
  Sheet,
  StatusPill,
  Text,
  TextLink,
  buttonStyles,
  textStyles,
} from "@ganger/ui";
import type { PillStatus } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useTranslations } from "use-intl";
import { useTime } from "../format/time";
import type { HomeRun, InputWait } from "@ganger/app/home/model";
import { todoTagOf } from "@ganger/app/home/model";
import { availableRunControl } from "@ganger/app/run-control-view";
import type { RunControl } from "@ganger/core";
import { QuestionForm } from "./question-form";
import type { SendState } from "./question-form";
import type { SheetMode } from "./run-card";
import { cardStatus, runHref, ticketHref, useRunText } from "./run-text";
import type { AnswerInput, DenyInput } from "./home-screen";

type Permission = Extract<InputWait, { kind: "permission" }>;

export interface SheetTarget {
  run: HomeRun;
  tagged: boolean;
  mode: SheetMode;
}

export function RunSheet({
  target,
  open,
  onOpenChange,
  finalFocus,
  all,
  onAnswer,
  onDeny,
  onControl,
}: {
  target: SheetTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: () => HTMLElement | null;
  all: boolean;
  onAnswer: (input: AnswerInput) => Promise<void>;
  onDeny: (input: DenyInput) => Promise<void>;
  onControl: SheetControl;
}) {
  const t = useTranslations("home.sheet");
  if (target === null) return null;
  const { run, tagged } = target;
  const tag = tagged ? todoTagOf(run) : null;
  const status = cardStatus(run, tag);
  const firstRadio = run.state === "waiting-for-input" && run.input?.kind === "question";
  const initialFocus = target.mode === "answer" && firstRadio ? 'input[type="radio"]' : undefined;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      status={<SheetStatus run={run} status={status} />}
      title={
        run.ticketTitle === null
          ? run.ticketKey
          : t("title", { key: run.ticketKey, title: run.ticketTitle })
      }
      closeLabel={t("close")}
      {...(initialFocus === undefined ? {} : { initialFocus })}
      finalFocus={finalFocus}
    >
      <div key={run.id} {...stylex.props(styles.body)}>
        <SheetBody
          run={run}
          tagged={tag !== null}
          onAnswer={onAnswer}
          onDeny={onDeny}
          onControl={onControl}
        />
        <RunFacts run={run} all={all} />
        <div>
          <TextLink href={runHref(run)}>{t("runDetail")}</TextLink>
        </div>
      </div>
    </Sheet>
  );
}

function SheetStatus({ run, status }: { run: HomeRun; status: PillStatus }) {
  const t = useTranslations("home.sheet");
  const { statusName } = useRunText();
  const { ago, elapsed } = useTime();
  const since = ((): string | null => {
    switch (run.state) {
      case "queued":
        return t("since.waiting", { elapsed: elapsed(run.waitMs) });
      case "running":
        return run.executionMs === null
          ? null
          : t("since.running", { elapsed: elapsed(run.executionMs) });
      case "paused":
        return run.pausedMs === null ? null : t("since.paused", { elapsed: elapsed(run.pausedMs) });
      case "waiting-for-input":
        return run.waitingMs === null
          ? null
          : t("since.waiting", { elapsed: elapsed(run.waitingMs) });
      case "disconnected":
        return null;
      case "ended":
        return t("since.ended", { ago: ago(run.endedAt, run.endedAgoMs) });
    }
  })();
  return (
    <>
      <StatusPill status={status}>{statusName(status)}</StatusPill>
      {since === null ? null : <span>{since}</span>}
    </>
  );
}

function SheetBody({
  run,
  tagged,
  onAnswer,
  onDeny,
  onControl,
}: {
  run: HomeRun;
  tagged: boolean;
  onAnswer: (input: AnswerInput) => Promise<void>;
  onDeny: (input: DenyInput) => Promise<void>;
  onControl: SheetControl;
}) {
  const t = useTranslations("home.sheet");
  const text = useRunText();
  switch (run.state) {
    case "queued":
      return <Text variant="body">{text.queued(run)}</Text>;
    case "running":
    case "paused":
      return (
        <ControlBlock run={run} onControl={onControl}>
          {t(run.state)}
        </ControlBlock>
      );
    case "disconnected":
      return (
        <Block>
          <Text variant="body">{text.unreachable(run)}</Text>
          <Text variant="ui" tone="muted" as="p">
            {t("disconnected")}
          </Text>
        </Block>
      );
    case "waiting-for-input": {
      const input = run.input;
      if (input === null) return <Text variant="body">{t("inputUnknown")}</Text>;
      switch (input.kind) {
        case "question":
          return <AnswerBlock run={run} question={input} onAnswer={onAnswer} />;
        case "permission":
          return <DenyBlock run={run} permission={input} onDeny={onDeny} />;
      }
      return null;
    }
    case "ended":
      if (tagged && run.summary === "human-check") return <HumanCheckBlock run={run} />;
      if (tagged && run.summary === "failed") return <FailedBlock run={run} />;
      return <EndedBlock run={run} />;
  }
}

type SheetControl = (run: HomeRun, control: RunControl, focusAfter?: () => void) => Promise<void>;

function ControlBlock({
  run,
  onControl,
  children,
}: {
  run: HomeRun;
  onControl: SheetControl;
  children: ReactNode;
}) {
  const t = useTranslations("home");
  const domain = useTranslations("domain");
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [sending, setSending] = useState(false);
  const control = run.control;
  const available = availableRunControl(run.state, run.cancelling, control);
  const pending =
    control?.status === "pending"
      ? t(control.control === "pause" ? "card.pausing" : "card.resuming")
      : null;
  return (
    <Block>
      <Text variant="body">{children}</Text>
      {control?.status === "failed" ? (
        <Text variant="ui" as="p" tone="problem">
          {t(control.control === "pause" ? "card.pauseFailed" : "card.resumeFailed", {
            reason: domain(`runControlFailure.${control.reason}`),
          })}
        </Text>
      ) : null}
      <Text variant="meta" as="p" ref={statusRef} role="status" tabIndex={-1}>
        {pending}
      </Text>
      {available === null ? null : (
        <div>
          <Button
            variant={available === "resume" ? "primary" : "secondary"}
            disabled={sending}
            onClick={() => {
              setSending(true);
              void onControl(run, available, () => statusRef.current?.focus()).finally(() =>
                setSending(false),
              );
            }}
          >
            {t(available === "resume" ? "card.resume" : "card.pause")}
          </Button>
        </div>
      )}
    </Block>
  );
}

function Block({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.block)}>{children}</div>;
}

function HumanCheckBlock({ run }: { run: HomeRun }) {
  const t = useTranslations("home.sheet");
  const pr = run.pullRequest;
  return (
    <Block>
      <Text variant="body">{pr === null ? t("humanCheckNoPr") : t("humanCheck")}</Text>
      {pr === null ? null : (
        <div>
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            data-variant="secondary"
            {...stylex.props(...buttonStyles("secondary"))}
          >
            {t("openPr", { pr: pr.displayId })}
          </a>
        </div>
      )}
    </Block>
  );
}

function FailedBlock({ run }: { run: HomeRun & { state: "ended" } }) {
  const t = useTranslations("home.sheet");
  const text = useRunText();
  return (
    <Block>
      <Text variant="body">{t("failed")}</Text>
      <DefinitionList>
        <DefinitionItem label={t("agentResult")}>{text.agentResult(run)}</DefinitionItem>
        <DefinitionItem label={t("prState")}>{text.prState(run)}</DefinitionItem>
      </DefinitionList>
      <div>
        <a
          href={ticketHref(run)}
          data-variant="secondary"
          {...stylex.props(...buttonStyles("secondary"))}
        >
          {t("retry")}
        </a>
      </div>
    </Block>
  );
}

function EndedBlock({ run }: { run: HomeRun & { state: "ended" } }) {
  const t = useTranslations("home.sheet");
  const text = useRunText();
  return (
    <DefinitionList>
      <DefinitionItem label={t("agentResult")}>{text.agentResult(run)}</DefinitionItem>
      <DefinitionItem label={t("prState")}>{text.prState(run)}</DefinitionItem>
    </DefinitionList>
  );
}

function RunFacts({ run, all }: { run: HomeRun; all: boolean }) {
  const t = useTranslations("home.sheet");
  const text = useRunText();
  return (
    <DefinitionList>
      <DefinitionItem label={t("ticket")}>
        {t("ticketValue", { key: run.ticketKey, project: run.trackerProject })}
      </DefinitionItem>
      {all ? <DefinitionItem label={t("workspace")}>{run.workspace.name}</DefinitionItem> : null}
      <DefinitionItem label={t("runner")} empty={run.runner === null}>
        {run.runner?.name ?? t("noRunner")}
      </DefinitionItem>
      <DefinitionItem label={t("agent")}>{text.agentName(run.agent)}</DefinitionItem>
    </DefinitionList>
  );
}

function useResultFocus() {
  const resultRef = useRef<HTMLSpanElement>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (sent) resultRef.current?.focus();
  }, [sent]);
  return { resultRef, sent, markSent: () => setSent(true) };
}

function ResultText({
  resultRef,
  children,
}: {
  resultRef: RefObject<HTMLSpanElement | null>;
  children: string;
}) {
  return (
    <span
      ref={resultRef}
      role="status"
      tabIndex={-1}
      {...stylex.props(textStyles("body"), styles.result)}
    >
      {children}
    </span>
  );
}

function AnswerBlock({
  run,
  question,
  onAnswer,
}: {
  run: HomeRun;
  question: Extract<InputWait, { kind: "question" }>;
  onAnswer: (input: AnswerInput) => Promise<void>;
}) {
  const t = useTranslations("home.question");
  const result = useResultFocus();
  if (result.sent || question.answered)
    return <ResultText resultRef={result.resultRef}>{t("answered")}</ResultText>;
  return (
    <QuestionForm
      question={question}
      onSend={async (answer) => {
        await onAnswer({ runId: run.id, questionId: question.questionId, answer });
        result.markSent();
      }}
    />
  );
}

function DenyBlock({
  run,
  permission,
  onDeny,
}: {
  run: HomeRun;
  permission: Permission;
  onDeny: (input: DenyInput) => Promise<void>;
}) {
  const t = useTranslations("home.permission");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<SendState>("idle");
  const result = useResultFocus();
  if (result.sent || permission.denied)
    return <ResultText resultRef={result.resultRef}>{t("denied")}</ResultText>;
  const sending = state === "sending";
  return (
    <form
      {...stylex.props(styles.block)}
      onSubmit={(event) => {
        event.preventDefault();
        if (sending) return;
        setState("sending");
        onDeny({ runId: run.id, promptId: permission.promptId, reason: reason.trim() }).then(
          () => {
            setState("idle");
            result.markSent();
          },
          () => setState("failed"),
        );
      }}
    >
      <CodeBlock>{permission.detail}</CodeBlock>
      <Text variant="body">{t("allowOnRunner")}</Text>
      <Field
        label={t("reasonLabel")}
        description={t("reasonDescription")}
        error={state === "failed" ? t("failed") : undefined}
      >
        <Input name="reason" value={reason} onValueChange={setReason} autoComplete="off" />
      </Field>
      <div {...stylex.props(styles.foot)}>
        <Button variant="danger" type="submit" disabled={sending}>
          {sending ? t("denying") : t("send")}
        </Button>
      </div>
    </form>
  );
}

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s6, minWidth: 0 },
  block: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  foot: { display: "flex", justifyContent: "flex-end", gap: space.s3 },
  result: { outline: "none" },
});

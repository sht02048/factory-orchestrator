import * as stylex from "@stylexjs/stylex";
import { Button, Dialog, DialogClose, Field, Input, Select, Text, showToast } from "@factory/ui";
import type { SelectOption } from "@factory/ui";
import { colors, space } from "@factory/ui/tokens.stylex";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { useAgentName } from "../labels";
import type { AssignInput, AssignResult } from "./assign";
import { agentsFor, runnersFor } from "./model";
import type { AssignDefaults, RunnerChoice, TicketView } from "./model";

/** 러너 Select 에서 "할당 때 자동으로 고르기"를 가리키는 값(Q53). 화면 안에서만 쓰고 서버에는 null 로 보낸다 */
export const AUTO_RUNNER = "\u0000auto";

type Failure = Extract<AssignResult, { ok: false }>["reason"] | "failed";

export interface AssignDialogProps {
  ticket: TicketView;
  defaults: AssignDefaults;
  runners: ReadonlyArray<RunnerChoice>;
  agents: ReadonlyArray<string>;
  triggerLabel: string;
  onAssign: (input: AssignInput) => Promise<AssignResult>;
}

/**
 * 수동 할당 창(Q53·Q60). Mapping 기본값을 채워 보이고, 러너 쪽 프로젝트는 바꿀 수 없고 러너와 에이전트만 바꾼다.
 * 확인하면 db 할당 진입점으로 Queued 런을 만든다. 실패하면 창을 닫지 않고 이유를 보인다.
 */
export function AssignDialog({
  ticket,
  defaults,
  runners,
  agents,
  triggerLabel,
  onAssign,
}: AssignDialogProps) {
  const t = useTranslations("tickets.assign");
  const [open, setOpen] = useState(false);
  const [runner, setRunner] = useState(AUTO_RUNNER);
  const [agent, setAgent] = useState(defaults.agent);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const reset = () => {
    setRunner(AUTO_RUNNER);
    setAgent(defaults.agent);
    setFailure(null);
  };

  const submit = () => {
    setPending(true);
    setFailure(null);
    onAssign({
      connection: ticket.connection,
      ticketKey: ticket.key,
      trackerProject: ticket.trackerProject.id,
      runnerId: runner === AUTO_RUNNER ? null : runner,
      agent,
    }).then(
      (result) => {
        setPending(false);
        if (result.ok) {
          setOpen(false);
          showToast(t("done", { key: ticket.key }));
        } else {
          setFailure(result.reason);
        }
      },
      () => {
        setPending(false);
        setFailure("failed");
      },
    );
  };

  return (
    <Dialog
      trigger={triggerLabel}
      triggerVariant="primary"
      title={t("title", { key: ticket.key })}
      description={t("description")}
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        setOpen(next);
      }}
      actions={
        <>
          <DialogClose>{t("cancel")}</DialogClose>
          <Button variant="primary" disabled={pending} onClick={submit}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </>
      }
    >
      <AssignForm
        defaults={defaults}
        runners={runners}
        agents={agents}
        runner={runner}
        agent={agent}
        onRunnerChange={setRunner}
        onAgentChange={setAgent}
      />
      {failure === null ? null : (
        <div role="alert" {...stylex.props(styles.error)}>
          <Text variant="ui">{t(`error.${failure}`)}</Text>
        </div>
      )}
    </Dialog>
  );
}

export interface AssignFormProps {
  defaults: AssignDefaults;
  runners: ReadonlyArray<RunnerChoice>;
  agents: ReadonlyArray<string>;
  /** 고른 러너 ID. AUTO_RUNNER 면 할당 때 자동으로 고른다 */
  runner: string;
  agent: string;
  onRunnerChange: (runner: string) => void;
  onAgentChange: (agent: string) => void;
}

/**
 * 러너 Select 의 항목: 맨 앞에 "할당 때 자동으로 고르기"(Q53), 그 뒤로 Mapping 의 러너 쪽 프로젝트가 있는 러너.
 * GitHub 인증이 깨진 러너는 비활성으로 이유와 함께 보인다(Q87). Offline 러너는 고를 수 있다.
 */
export function runnerOptionsFor(
  runners: ReadonlyArray<RunnerChoice>,
  runnerProject: string,
  label: { auto: string; offline: (name: string) => string; blocked: (name: string) => string },
): SelectOption[] {
  return [
    { value: AUTO_RUNNER, label: label.auto },
    ...runnersFor(runners, runnerProject).map((r): SelectOption => {
      if (r.assignmentBlocked) return { value: r.id, label: label.blocked(r.name), disabled: true };
      return { value: r.id, label: r.online ? r.name : label.offline(r.name) };
    }),
  ];
}

/** 할당 창의 칸. 러너 쪽 프로젝트는 읽기 전용이고, 인증이 깨진 러너는 보이되 고를 수 없다(Q87) */
export function AssignForm({
  defaults,
  runners,
  agents,
  runner,
  agent,
  onRunnerChange,
  onAgentChange,
}: AssignFormProps) {
  const t = useTranslations("tickets.assign");
  const runnerOptions = runnerOptionsFor(runners, defaults.runnerProject, {
    auto: t("runnerAuto"),
    offline: (name) => t("runnerOffline", { name }),
    blocked: (name) => t("runnerBlocked", { name }),
  });
  const agentName = useAgentName();
  const agentOptions: SelectOption[] = agentsFor(agents, defaults.agent).map((a) => ({
    value: a,
    label: agentName(a),
  }));
  return (
    <div {...stylex.props(styles.form)}>
      <Field label={t("project")} description={t("projectHint")}>
        <Input name="runnerProject" value={defaults.runnerProject} readOnly mono />
      </Field>
      <Field label={t("runner")} description={t("runnerHint")}>
        <Select
          name="runner"
          value={runner}
          onValueChange={onRunnerChange}
          options={runnerOptions}
        />
      </Field>
      <Field label={t("agent")}>
        <Select name="agent" value={agent} onValueChange={onAgentChange} options={agentOptions} />
      </Field>
    </div>
  );
}

const styles = stylex.create({
  form: { display: "flex", flexDirection: "column", gap: space.s4 },
  error: { color: colors.failed },
});

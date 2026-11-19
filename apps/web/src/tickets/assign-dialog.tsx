import * as stylex from "@stylexjs/stylex";
import { Button, Dialog, DialogClose, Field, Input, Select, Text, showToast } from "@ganger/ui";
import type { SelectOption } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { useAgentName } from "../labels";
import type { AssignInput, AssignResult } from "@ganger/app/tickets/assign";
import { agentsFor, runnersFor } from "@ganger/app/tickets/model";
import type { AssignDefaults, RunnerChoice, TicketView } from "@ganger/app/tickets/model";

export const AUTO_RUNNER = "\u0000auto";

type Failure = Extract<AssignResult, { ok: false }>["reason"] | "failed";

export interface AssignDialogProps {
  ticket: TicketView;
  defaults: AssignDefaults;
  runners: ReadonlyArray<RunnerChoice>;
  agents: ReadonlyArray<string>;
  triggerLabel: string;
  onAssign: (input: AssignInput) => Promise<AssignResult>;
  onAssigned: () => void;
}

export function AssignDialog({
  ticket,
  defaults,
  runners,
  agents,
  triggerLabel,
  onAssign,
  onAssigned,
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
      ticketTitle: ticket.title,
      trackerProject: ticket.trackerProject.id,
      runnerId: runner === AUTO_RUNNER ? null : runner,
      agent,
    }).then(
      (result) => {
        setPending(false);
        if (result.ok) {
          setOpen(false);
          showToast(t("done", { key: ticket.key }));
          onAssigned();
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
        if (!next && pending) return;
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
        <Text variant="ui" as="div" tone="problem" role="alert">
          {t(`error.${failure}`)}
        </Text>
      )}
    </Dialog>
  );
}

export interface AssignFormProps {
  defaults: AssignDefaults;
  runners: ReadonlyArray<RunnerChoice>;
  agents: ReadonlyArray<string>;
  runner: string;
  agent: string;
  onRunnerChange: (runner: string) => void;
  onAgentChange: (agent: string) => void;
}

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
});

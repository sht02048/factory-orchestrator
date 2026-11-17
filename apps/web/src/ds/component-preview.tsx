import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  DefinitionItem,
  DefinitionList,
  DetailPanel,
  Dialog,
  DialogClose,
  Dot,
  Field,
  Input,
  Menu,
  MenuRadio,
  MenuRadioOption,
  MenuSeparator,
  PanelBlock,
  PanelFooter,
  PanelHeader,
  RowReason,
  RowTitle,
  Section,
  Select,
  SplitView,
  Status,
  Tab,
  TabPanel,
  Table,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableRows,
  Tabs,
  Text,
  Tooltip,
  showToast,
  type StatusTone,
} from "@factory/ui";
import { colors, fontWeight, radius, space } from "@factory/ui/tokens.stylex";
import { useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";

type RunId = "r1051" | "r1049" | "r1047" | "r1044";

interface SampleRun {
  id: RunId;
  number: number;
  ticket: string;
  tone: StatusTone;
  state: "check" | "failed" | "running" | "merged";
  runner: string;
  agent: string;
  elapsed: string;
  pr: number | null;
  ci: "ciPassed" | "ciRunning" | null;
}

// 가상 값(ADR 0005): 러너·티켓 키·프로젝트는 예시 이름이다. 고유명이라 메시지 파일에 두지 않는다.
const runs: ReadonlyArray<SampleRun> = [
  {
    id: "r1051",
    number: 1051,
    ticket: "ACME-123",
    tone: "check",
    state: "check",
    runner: "runner-a",
    agent: "Claude Code",
    elapsed: "42:10",
    pr: 418,
    ci: "ciPassed",
  },
  {
    id: "r1049",
    number: 1049,
    ticket: "ACME-119",
    tone: "failed",
    state: "failed",
    runner: "runner-b",
    agent: "Codex",
    elapsed: "18:02",
    pr: null,
    ci: null,
  },
  {
    id: "r1047",
    number: 1047,
    ticket: "ACME-131",
    tone: "running",
    state: "running",
    runner: "runner-a",
    agent: "Claude Code",
    elapsed: "07:45",
    pr: null,
    ci: "ciRunning",
  },
  {
    id: "r1044",
    number: 1044,
    ticket: "ACME-108",
    tone: "neutral",
    state: "merged",
    runner: "runner-c",
    agent: "Codex",
    elapsed: "23:51",
    pr: 412,
    ci: "ciPassed",
  },
];

const runColumns = "minmax(0, 1fr) 96px 80px 96px 56px";

type FilterKey = "all" | "todo" | "running" | "queued";

function Demo({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.demo)}>{children}</div>;
}

export function ComponentSections() {
  const t = useTranslations("ds");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selected, setSelected] = useState<RunId>("r1051");
  const [workspace, setWorkspace] = useState("commerce");
  const [agent, setAgent] = useState<string | null>(null);

  const stateLabel = (state: SampleRun["state"]) => t(`status.${state}`);
  const current = runs.find((r) => r.id === selected) ?? runs[0];

  return (
    <>
      <div id="buttons">
        <Section title={t("nav.buttons")} note={t("buttons.note")}>
          <Demo>
            <Actions>
              <Button variant="primary">{t("buttons.primary")}</Button>
              <Button>{t("buttons.default")}</Button>
              <Button variant="ghost">{t("buttons.ghost")}</Button>
              <Button disabled>{t("buttons.disabled")}</Button>
            </Actions>
          </Demo>
        </Section>
      </div>

      <div id="status">
        <Section title={t("nav.status")} note={t("status.note")}>
          <Demo>
            <div {...stylex.props(styles.row)}>
              <Status tone="check">{t("status.check")}</Status>
              <Status tone="failed">{t("status.failed")}</Status>
              <Status tone="running">{t("status.running")}</Status>
              <Status tone="neutral">{t("status.queued")}</Status>
              <Status tone="neutral" dot={false}>
                {t("status.merged")}
              </Status>
            </div>
            <div {...stylex.props(styles.row)}>
              <span {...stylex.props(styles.inline)}>
                <Dot tone="online" />
                <Text variant="ui">{t("status.online")}</Text>
              </span>
              <span {...stylex.props(styles.inline)}>
                <Dot tone="offline" />
                <Text variant="ui">{t("status.offline")}</Text>
              </span>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="tabs">
        <Section title={t("nav.tabs")}>
          <Tabs<FilterKey>
            value={filter}
            onValueChange={setFilter}
            label={t("tabs.label")}
            panels={
              <>
                <TabPanel value="all">
                  <Text variant="meta">{t("tabs.panelAll")}</Text>
                </TabPanel>
                <TabPanel value="todo">
                  <Text variant="meta">{t("tabs.panelTodo")}</Text>
                </TabPanel>
                <TabPanel value="running">
                  <Text variant="meta">{t("tabs.panelRunning")}</Text>
                </TabPanel>
                <TabPanel value="queued">
                  <TableEmpty>{t("tabs.panelQueued")}</TableEmpty>
                </TabPanel>
              </>
            }
          >
            <Tab value="all" count={42}>
              {t("tabs.all")}
            </Tab>
            <Tab value="todo" count={2} attention>
              {t("tabs.todo")}
            </Tab>
            <Tab value="running" count={1}>
              {t("tabs.running")}
            </Tab>
            <Tab value="queued" count={0}>
              {t("tabs.queued")}
            </Tab>
          </Tabs>
        </Section>
      </div>

      <div id="table">
        <Section title={t("nav.table")} note={t("table.note")}>
          <div {...stylex.props(styles.frame)}>
            <SplitView
              fill={false}
              list={
                <Table columns={runColumns}>
                  <TableHead>
                    <TableHeader>{t("table.colTicket")}</TableHeader>
                    <TableHeader>{t("table.colState")}</TableHeader>
                    <TableHeader>{t("table.colRunner")}</TableHeader>
                    <TableHeader>{t("table.colAgent")}</TableHeader>
                    <TableHeader align="end">{t("table.colElapsed")}</TableHeader>
                  </TableHead>
                  <TableRows
                    label={t("table.listLabel")}
                    value={selected}
                    onValueChange={(v) => {
                      const run = runs.find((r) => r.id === v);
                      if (run !== undefined) setSelected(run.id);
                    }}
                  >
                    {runs.map((run) => {
                      const reason = t(`table.rows.${run.id}.reason`);
                      return (
                        <TableRow
                          key={run.id}
                          value={run.id}
                          label={t(`table.rows.${run.id}.title`)}
                        >
                          <TableCell>
                            <RowTitle>{t(`table.rows.${run.id}.title`)}</RowTitle>
                            {reason === "" ? null : (
                              <RowReason>
                                <Dot tone={run.tone} />
                                {reason}
                              </RowReason>
                            )}
                          </TableCell>
                          <TableCell>
                            <Status tone={run.tone} dot={false}>
                              {stateLabel(run.state)}
                            </Status>
                          </TableCell>
                          <TableCell>{run.runner}</TableCell>
                          <TableCell>{run.agent}</TableCell>
                          <TableCell align="end" numeric>
                            {run.elapsed}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableRows>
                </Table>
              }
              panel={
                current === undefined ? null : (
                  <RunPanel run={current} stateLabel={stateLabel(current.state)} />
                )
              }
            />
          </div>
        </Section>
      </div>

      <div id="definitions">
        <Section title={t("nav.definitions")} note={t("definitions.note")}>
          <Demo>
            <DefinitionList>
              <DefinitionItem label={t("definitions.runner")}>runner-a</DefinitionItem>
              <DefinitionItem label={t("definitions.project")}>acme/web</DefinitionItem>
              <DefinitionItem label={t("definitions.pr")} empty>
                {t("definitions.none")}
              </DefinitionItem>
            </DefinitionList>
          </Demo>
        </Section>
      </div>

      <div id="menu">
        <Section title={t("nav.menu")} note={t("menu.note")}>
          <Demo>
            <div {...stylex.props(styles.narrow)}>
              <Menu
                trigger={
                  <>
                    <span {...stylex.props(styles.menuLabel)}>{t("menu.label")}</span>
                    {t(
                      `menu.${workspace === "labs" ? "labs" : workspace === "all" ? "all" : "commerce"}`,
                    )}
                  </>
                }
              >
                <MenuRadio value={workspace} onValueChange={setWorkspace}>
                  <MenuRadioOption value="commerce">{t("menu.commerce")}</MenuRadioOption>
                  <MenuRadioOption value="labs">{t("menu.labs")}</MenuRadioOption>
                  <MenuSeparator />
                  <MenuRadioOption value="all">{t("menu.all")}</MenuRadioOption>
                </MenuRadio>
              </Menu>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="form">
        <Section title={t("nav.form")} note={t("form.note")}>
          <Demo>
            <div {...stylex.props(styles.form)}>
              <Field label={t("form.hostLabel")} description={t("form.hostHint")}>
                <Input name="host" defaultValue="runner-a" mono />
              </Field>
              <Field label={t("form.pathLabel")} error={t("form.pathError")}>
                <Input name="orca" defaultValue="/opt/orca/bin" mono />
              </Field>
              <Field label={t("form.agentLabel")}>
                <Select
                  value={agent}
                  onValueChange={setAgent}
                  placeholder={t("form.agentPlaceholder")}
                  options={[
                    { value: "claude", label: t("form.agentClaude") },
                    { value: "codex", label: t("form.agentCodex") },
                  ]}
                />
              </Field>
              <Field label={t("form.webhookLabel")}>
                <Input
                  name="webhook"
                  defaultValue="https://orchestrator.example.com/webhooks/linear"
                  readOnly
                  mono
                />
              </Field>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="tooltip">
        <Section title={t("nav.tooltip")} note={t("tooltip.note")}>
          <Demo>
            <Text variant="ui">
              <Tooltip content={t("tooltip.content")}>{t("tooltip.trigger")}</Tooltip>
            </Text>
          </Demo>
        </Section>
      </div>

      <div id="dialog">
        <Section title={t("nav.dialog")} note={t("dialog.note")}>
          <Demo>
            <Dialog
              trigger={t("dialog.trigger")}
              title={t("dialog.title")}
              description={t("dialog.description")}
              actions={
                <>
                  <DialogClose>{t("dialog.cancel")}</DialogClose>
                  <DialogClose variant="primary" onClick={() => showToast(t("dialog.done"))}>
                    {t("dialog.confirm")}
                  </DialogClose>
                </>
              }
            />
          </Demo>
        </Section>
      </div>

      <div id="toast">
        <Section title={t("nav.toast")} note={t("toast.note")}>
          <Demo>
            <Button onClick={() => showToast(t("toast.message"))}>{t("toast.trigger")}</Button>
          </Demo>
        </Section>
      </div>
    </>
  );
}

function RunPanel({ run, stateLabel }: { run: SampleRun; stateLabel: string }) {
  const t = useTranslations("ds");
  return (
    <DetailPanel>
      <PanelHeader
        status={
          <>
            <Status tone={run.tone}>{stateLabel}</Status>
            <Text variant="meta" numeric>
              #{run.number}
            </Text>
          </>
        }
        title={t(`table.rows.${run.id}.title`)}
        subtitle={`${run.ticket} · acme/web`}
        reason={t(`table.rows.${run.id}.detail`)}
      />
      <Actions>
        {run.pr === null ? (
          <Button variant={run.state === "failed" ? "primary" : "default"}>
            {t("table.rerun")}
          </Button>
        ) : (
          <>
            <Button variant="primary">{t("table.openPr", { number: run.pr })}</Button>
            <Button>{t("table.rerun")}</Button>
          </>
        )}
      </Actions>
      <PanelBlock>
        <DefinitionList>
          <DefinitionItem label={t("definitions.runner")}>{run.runner}</DefinitionItem>
          <DefinitionItem label={t("definitions.agent")}>{run.agent}</DefinitionItem>
          <DefinitionItem label={t("definitions.elapsed")}>{run.elapsed}</DefinitionItem>
          <DefinitionItem label={t("definitions.pr")} empty={run.pr === null}>
            {run.pr === null ? t("definitions.none") : `#${run.pr}`}
          </DefinitionItem>
          <DefinitionItem label={t("definitions.ci")} empty={run.ci === null}>
            {run.ci === null ? t("definitions.none") : t(`definitions.${run.ci}`)}
          </DefinitionItem>
        </DefinitionList>
      </PanelBlock>
      <PanelFooter>
        <Text variant="meta">{t("table.footer", { number: run.number })}</Text>
      </PanelFooter>
    </DetailPanel>
  );
}

const styles = stylex.create({
  demo: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.s4,
    paddingBlock: space.s5,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s6 },
  inline: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  frame: {
    height: 440,
    overflow: "hidden",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
  },
  narrow: { width: 216 },
  menuLabel: { color: colors.textTertiary, fontWeight: fontWeight.regular },
  form: { display: "flex", flexDirection: "column", gap: space.s5, width: "100%", maxWidth: 520 },
});

import * as stylex from "@stylexjs/stylex";
import {
  AppFrame,
  Button,
  CheckIcon,
  CheckTick,
  Checklist,
  ChecklistItem,
  ChevronDownIcon,
  Chip,
  CloseIcon,
  CodeBlock,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableRowHeader,
  Disclosure,
  DividedItem,
  DividedList,
  DoneMark,
  FailureBar,
  KanbanCard,
  KanbanCards,
  KanbanColumn,
  KanbanSubheading,
  NoticeLayout,
  NumberedList,
  OUTCOME_TONES,
  OutcomeBar,
  OutcomeSwatch,
  PageHeader,
  Popover,
  RadioGroup,
  RadioOption,
  RailBrand,
  RailLinkContent,
  RailNav,
  RailNavList,
  RailStatic,
  RemovableChip,
  Section,
  StackedBarChart,
  StepMarker,
  StepNav,
  StepNavItem,
  Text,
  TextLink,
  Textarea,
  VisuallyHidden,
  WorkspaceBadge,
  railLinkStyles,
  ScrollRegion,
  Sheet,
  StatusPill,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";

export const blockSectionIds = [
  "shell",
  "links",
  "chips",
  "choices",
  "codeBlock",
  "dataTable",
  "outcomes",
  "steps",
  "disclosure",
  "dividedList",
  "popover",
  "kanban",
  "sheet",
  "icons",
] as const;

const sampleSegments = [
  { tone: "merged", value: 6 },
  { tone: "check", value: 2 },
  { tone: "failed", value: 1 },
  { tone: "canceled", value: 1 },
] as const;

function Demo({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.demo)}>{children}</div>;
}

export function BlockSections() {
  const t = useTranslations("ds.blocks");
  const tNav = useTranslations("ds.nav");
  const radioName = useId();
  const chartId = useId();
  const [choice, setChoice] = useState("retry");
  const [note, setNote] = useState("");
  const [chips, setChips] = useState<ReadonlyArray<string>>([t("chips.runner"), t("chips.days")]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <div id="shell">
        <Section title={tNav("shell")} note={t("shell.note")}>
          <div {...stylex.props(styles.frame)}>
            <AppFrame
              fill={false}
              rail={
                <>
                  <RailBrand>
                    <Text variant="label">{t("shell.brand")}</Text>
                  </RailBrand>
                  <RailStatic>
                    <WorkspaceBadge name={t("shell.workspace")} initial="A" />
                  </RailStatic>
                  <RailNav label={t("shell.navLabel")}>
                    <RailNavList>
                      <li>
                        <a
                          href="#shell"
                          aria-current="page"
                          {...stylex.props(railLinkStyles(true))}
                        >
                          <RailLinkContent
                            icon={<CheckIcon />}
                            name={t("shell.current")}
                            issues={0}
                          />
                        </a>
                      </li>
                      <li>
                        <a href="#shell" {...stylex.props(railLinkStyles(false))}>
                          <RailLinkContent
                            icon={<CloseIcon />}
                            name={t("shell.issues")}
                            issues={2}
                          />
                        </a>
                      </li>
                    </RailNavList>
                  </RailNav>
                </>
              }
            >
              <NoticeLayout>
                <PageHeader title={t("shell.pageTitle")} />
                <Text variant="body">{t("shell.notice")}</Text>
              </NoticeLayout>
            </AppFrame>
          </div>
        </Section>
      </div>

      <div id="links">
        <Section title={tNav("links")} note={t("links.note")}>
          <Demo>
            <span {...stylex.props(styles.row)}>
              <TextLink href="#links">{t("links.accent")}</TextLink>
              <TextLink href="#links" tone="quiet">
                {t("links.quiet")}
              </TextLink>
              <TextLink href="#links" tone="action">
                {t("links.action")}
              </TextLink>
              <TextLink href="#links" tone="plain">
                {t("links.plain")}
              </TextLink>
            </span>
            <Text variant="ui" tone="problem">
              {t("links.problemTone")}
            </Text>
          </Demo>
        </Section>
      </div>

      <div id="chips">
        <Section title={tNav("chips")} note={t("chips.note")}>
          <Demo>
            <span {...stylex.props(styles.row)}>
              <Chip strong>{t("chips.required")}</Chip>
              <Chip>{t("chips.optional")}</Chip>
              <Chip tone="accent">{t("chips.you")}</Chip>
              <Chip tone="accent">
                <VisuallyHidden>{t("chips.youLabel")}</VisuallyHidden>
                <span aria-hidden>{t("chips.remoteLogin")}</span>
              </Chip>
            </span>
            <span {...stylex.props(styles.row)}>
              {chips.map((chip) => (
                <RemovableChip
                  key={chip}
                  removeLabel={t("chips.remove", { condition: chip })}
                  onRemove={() => setChips((all) => all.filter((c) => c !== chip))}
                >
                  {chip}
                </RemovableChip>
              ))}
            </span>
          </Demo>
        </Section>
      </div>

      <div id="choices">
        <Section title={tNav("choices")} note={t("choices.note")}>
          <Demo>
            <div {...stylex.props(styles.narrow)}>
              <RadioGroup>
                {(["retry", "skip"] as const).map((value) => (
                  <RadioOption
                    key={value}
                    name={radioName}
                    value={value}
                    checked={choice === value}
                    onCheck={() => setChoice(value)}
                  >
                    {t(`choices.${value}`)}
                  </RadioOption>
                ))}
              </RadioGroup>
              <Textarea
                aria-label={t("choices.textareaLabel")}
                rows={3}
                value={note}
                onValueChange={setNote}
                placeholder={t("choices.textareaPlaceholder")}
              />
            </div>
          </Demo>
        </Section>
      </div>

      <div id="codeBlock">
        <Section title={tNav("codeBlock")} note={t("codeBlock.note")}>
          <Demo>
            <div {...stylex.props(styles.narrow)}>
              <CodeBlock>{t("codeBlock.output")}</CodeBlock>
              <CodeBlock tone="command">{t("codeBlock.command")}</CodeBlock>
              <CodeBlock scroll label={t("codeBlock.logLabel")}>
                {t("codeBlock.log")}
              </CodeBlock>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="dataTable">
        <Section title={tNav("dataTable")} note={t("dataTable.note")}>
          <Demo>
            <div {...stylex.props(styles.narrow)}>
              <DataTable label={t("dataTable.label")} framed>
                <DataTableHead>
                  <DataTableHeader>{t("dataTable.project")}</DataTableHeader>
                  <DataTableHeader align="end">{t("dataTable.runs")}</DataTableHeader>
                  <DataTableHeader shrink>
                    <VisuallyHidden>{t("dataTable.state")}</VisuallyHidden>
                  </DataTableHeader>
                </DataTableHead>
                <DataTableBody>
                  <DataTableRow>
                    <DataTableRowHeader strong>{t("dataTable.web")}</DataTableRowHeader>
                    <DataTableCell align="end" numeric>
                      12
                    </DataTableCell>
                    <DataTableCell>
                      <CheckTick done label={t("dataTable.done")} />
                    </DataTableCell>
                  </DataTableRow>
                  <DataTableRow>
                    <DataTableRowHeader strong>{t("dataTable.api")}</DataTableRowHeader>
                    <DataTableCell align="end" numeric>
                      3
                    </DataTableCell>
                    <DataTableCell>
                      <CheckTick done={false} label={t("dataTable.empty")} />
                    </DataTableCell>
                  </DataTableRow>
                </DataTableBody>
              </DataTable>
              <DataTable caption={t("dataTable.caption")} density="compact">
                <DataTableHead>
                  <DataTableHeader>{t("dataTable.day")}</DataTableHeader>
                  <DataTableHeader align="end">{t("dataTable.runs")}</DataTableHeader>
                </DataTableHead>
                <DataTableBody>
                  <DataTableRow>
                    <DataTableRowHeader>{t("dataTable.today")}</DataTableRowHeader>
                    <DataTableCell align="end">4</DataTableCell>
                  </DataTableRow>
                </DataTableBody>
              </DataTable>
              <ScrollRegion label={t("dataTable.scrollLabel")} minWidth="560px">
                <DataTable caption={t("dataTable.scrollLabel")} captionHidden fixed>
                  <DataTableHead>
                    <DataTableHeader>{t("dataTable.project")}</DataTableHeader>
                    <DataTableHeader align="end">{t("dataTable.runs")}</DataTableHeader>
                    <DataTableHeader align="end">{t("dataTable.state")}</DataTableHeader>
                  </DataTableHead>
                  <DataTableBody>
                    <DataTableRow>
                      <DataTableRowHeader strong>{t("dataTable.web")}</DataTableRowHeader>
                      <DataTableCell align="end" numeric>
                        12
                      </DataTableCell>
                      <DataTableCell align="end">{t("dataTable.done")}</DataTableCell>
                    </DataTableRow>
                  </DataTableBody>
                </DataTable>
              </ScrollRegion>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="outcomes">
        <Section title={tNav("outcomes")} note={t("outcomes.note")}>
          <Demo>
            <div {...stylex.props(styles.narrow)}>
              <span {...stylex.props(styles.row)}>
                {OUTCOME_TONES.map((tone) => (
                  <span key={tone} {...stylex.props(styles.row)}>
                    <OutcomeSwatch tone={tone} />
                    <Text variant="meta">{t(`outcomes.${tone}`)}</Text>
                  </span>
                ))}
              </span>
              <OutcomeBar segments={sampleSegments} label={t("outcomes.barLabel")} />
              <FailureBar value={3} max={5} />
              <StackedBarChart
                label={t("outcomes.chartLabel")}
                detailsId={chartId}
                ticks={[0, 2, 4, 6, 8]}
                top={8}
                bars={[
                  { key: "a", title: t("outcomes.yesterday"), segments: sampleSegments },
                  { key: "b", title: t("outcomes.today"), segments: sampleSegments.slice(0, 2) },
                ]}
                barLabels={[t("outcomes.yesterday"), t("outcomes.today")]}
              />
            </div>
          </Demo>
        </Section>
      </div>

      <div id="steps">
        <Section title={tNav("steps")} note={t("steps.note")}>
          <Demo>
            <div {...stylex.props(styles.columns)}>
              <StepNav label={t("steps.navLabel")} title={t("steps.title")}>
                <StepNavItem
                  number={1}
                  name={t("steps.first")}
                  state="done"
                  doneLabel={t("steps.done")}
                  onSelect={() => {}}
                />
                <StepNavItem
                  number={2}
                  name={t("steps.second")}
                  state="current"
                  doneLabel={t("steps.done")}
                />
                <StepNavItem
                  number={3}
                  name={t("steps.third")}
                  state="todo"
                  doneLabel={t("steps.done")}
                />
              </StepNav>
              <div {...stylex.props(styles.narrow)}>
                <span {...stylex.props(styles.row)}>
                  <StepMarker state="todo">1</StepMarker>
                  <StepMarker state="current">2</StepMarker>
                  <StepMarker state="done">3</StepMarker>
                  <DoneMark />
                </span>
                <NumberedList items={[t("steps.first"), t("steps.second"), t("steps.third")]} />
                <Checklist label={t("steps.checklist")}>
                  <ChecklistItem done label={t("steps.done")}>
                    {t("steps.first")}
                  </ChecklistItem>
                  <ChecklistItem done={false} running label={t("steps.running")}>
                    {t("steps.second")}
                    <Text variant="meta">{t("steps.running")}</Text>
                  </ChecklistItem>
                  <ChecklistItem done={false} label={t("steps.notDone")}>
                    {t("steps.third")}
                  </ChecklistItem>
                </Checklist>
              </div>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="disclosure">
        <Section title={tNav("disclosure")} note={t("disclosure.note")}>
          <Demo>
            <div {...stylex.props(styles.narrow)}>
              <Disclosure summary={t("disclosure.summary")}>
                <Text variant="body">{t("disclosure.body")}</Text>
              </Disclosure>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="dividedList">
        <Section title={tNav("dividedList")} note={t("dividedList.note")}>
          <Demo>
            <DividedList>
              <DividedItem>
                <Text variant="ui" tone="strong">
                  {t("dividedList.first")}
                </Text>
              </DividedItem>
              <DividedItem tight>
                <Text variant="ui" tone="strong">
                  {t("dividedList.second")}
                </Text>
                <Text variant="meta">{t("dividedList.tight")}</Text>
              </DividedItem>
            </DividedList>
          </Demo>
        </Section>
      </div>

      <div id="popover">
        <Section title={tNav("popover")} note={t("popover.note")}>
          <Demo>
            <Popover
              trigger={t("popover.trigger")}
              title={t("popover.title")}
              closeLabel={t("popover.close")}
              open={popoverOpen}
              onOpenChange={setPopoverOpen}
            >
              <Text variant="body">{t("popover.body")}</Text>
            </Popover>
          </Demo>
        </Section>
      </div>

      <div id="kanban">
        <Section title={tNav("kanban")} note={t("kanban.note")}>
          <div {...stylex.props(styles.kanban)}>
            <KanbanColumn title={t("kanban.column")} count={2}>
              <KanbanCards>
                <li>
                  <KanbanCard
                    tag={<StatusPill status="question">{t("kanban.tag")}</StatusPill>}
                    title={t("kanban.title")}
                    detail={t("kanban.detail")}
                    meta={t("kanban.meta")}
                    time={t("kanban.time")}
                    action={<Button>{t("kanban.action")}</Button>}
                    onOpen={() => setSheetOpen(true)}
                  />
                </li>
                <li>
                  <KanbanCard
                    title={t("kanban.plainTitle")}
                    meta={t("kanban.meta")}
                    time={t("kanban.time")}
                    onOpen={() => setSheetOpen(true)}
                  />
                </li>
              </KanbanCards>
              <KanbanSubheading>{t("kanban.subheading")}</KanbanSubheading>
            </KanbanColumn>
          </div>
        </Section>
      </div>

      <div id="sheet">
        <Section title={tNav("sheet")} note={t("sheet.note")}>
          <Demo>
            <Button onClick={() => setSheetOpen(true)}>{t("sheet.open")}</Button>
            <Sheet
              open={sheetOpen}
              onOpenChange={setSheetOpen}
              status={<StatusPill status="question">{t("kanban.tag")}</StatusPill>}
              title={t("kanban.title")}
              subtitle={t("kanban.meta")}
              closeLabel={t("sheet.close")}
            >
              <Text variant="body">{t("kanban.detail")}</Text>
            </Sheet>
          </Demo>
        </Section>
      </div>

      <div id="icons">
        <Section title={tNav("icons")} note={t("icons.note")}>
          <Demo>
            <span {...stylex.props(styles.row)}>
              <CheckIcon />
              <CloseIcon />
              <ChevronDownIcon />
              <VisuallyHidden>{t("icons.hidden")}</VisuallyHidden>
            </span>
          </Demo>
        </Section>
      </div>
    </>
  );
}

const styles = stylex.create({
  demo: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.s4,
    paddingBlock: space.s5,
  },
  row: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
  narrow: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    width: "100%",
    maxWidth: 640,
  },
  columns: { display: "flex", flexWrap: "wrap", gap: space.s10 },
  frame: { height: 320, overflow: "hidden" },
  kanban: { width: "100%", maxWidth: 360, paddingBlock: space.s5 },
});

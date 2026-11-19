import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  Card,
  CheckTick,
  Checkbox,
  Checklist,
  ChecklistItem,
  Chip,
  CodeBlock,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableRowHeader,
  Disclosure,
  DoneMark,
  Field,
  Input,
  Mascot,
  NumberedList,
  PanelBlock,
  Select,
  StepNav,
  StepNavItem,
  Text,
  VisuallyHidden,
  buttonStyles,
  focusStyles,
  linkStyles,
  surfaceStyles,
  textStyles,
  visuallyHiddenStyles,
} from "@ganger/ui";
import { breakpoints, size, space } from "@ganger/ui/tokens.stylex";
import type { ReactNode, Ref, RefObject } from "react";
import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import {
  toAgentId,
  toLabelId,
  toRunnerProjectId,
  toTrackerConnectionId,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import type {
  AgentId,
  LabelId,
  RunnerProjectId,
  TrackerConnectionId,
  TrackerProjectId,
  TrackerStateId,
} from "@ganger/core";
import type { WorkspaceId } from "@ganger/db";
import { useAgentName, usePrerequisiteName } from "../labels";
import { PushProblems, useCheckingText, usePushSummaryText } from "../push-check";
import { runnerWideChecks, summarizePushChecks } from "@ganger/app/prerequisites";
import type { PushSummary } from "@ganger/app/prerequisites";
import {
  RunnerCheck,
  RunnerForm,
  SubmitError,
  passwordManagerIgnoredSecretProps,
  useReason,
  useRunnerCheckPolling,
  useRunnerErrorName,
  useSubmit,
  withCurrent,
} from "../settings/settings-screen";
import type { ActionResult, SettingsActions, SubmitState } from "../settings/settings-screen";
import type {
  BoundProject,
  Choice,
  ConnectionLabel,
  ConnectionProjects,
  PrerequisiteView,
  RunnerSettingsView,
  SettingsPage,
  TrackerConnectionView,
  WorkspaceSettings,
} from "@ganger/app/settings/model";
import {
  GITHUB_TOKEN_URL,
  LINEAR_API_KEY_URL,
  ONBOARDING_STEPS,
  mappingRowComplete,
  missingMappingParts,
  pushNeedsWarning,
  reachableIndex,
  runnerPassed,
  runnerProblems,
  serviceInstallCommand,
  serviceInstallTemplate,
  stepPassed,
} from "./model";
import type { OnboardingStep } from "./model";
import { createSerialSaver } from "./serial-save";

export interface WorkspaceSetupInput {
  name: string;
  projects: Array<{
    connectionId: TrackerConnectionId;
    projectId: TrackerProjectId;
    name: string;
  }>;
}

export interface OnboardingActions extends SettingsActions {
  setUpWorkspace: (input: WorkspaceSetupInput) => Promise<ActionResult>;
}

export interface OnboardingScreenProps {
  page: SettingsPage;
  trackerProjects: ConnectionProjects[];
  index: number;
  onStep: (index: number) => void;
  onFinish: () => void;
  actions: OnboardingActions;
}

export function OnboardingScreen({
  page,
  trackerProjects,
  index,
  onStep,
  onFinish,
  actions,
}: OnboardingScreenProps) {
  const t = useTranslations("onboarding");
  const step: OnboardingStep = ONBOARDING_STEPS[index] ?? "tracker";
  const passed = stepPassed(page, step);
  const last = index === ONBOARDING_STEPS.length - 1;

  const pendingKey = page.install.runners
    .flatMap((r) => (r.check?.status === "pending" ? [`${r.id}@${r.check.requestedAt}`] : []))
    .join(",");
  const workerSilent = useRunnerCheckPolling(pendingKey, actions.pollRunnerChecks);

  const titleRef = useRef<HTMLSpanElement>(null);
  const shownIndex = useRef(index);
  useEffect(() => {
    if (index === shownIndex.current) return;
    shownIndex.current = index;
    titleRef.current?.focus();
  }, [index]);
  const lockedId = useId();

  return (
    <div {...stylex.props(styles.page)}>
      <StepList page={page} index={index} onStep={onStep} />
      <main {...stylex.props(styles.column)}>
        <div {...stylex.props(styles.heading)}>
          {index === 0 ? <Mascot mood="default" size="small" /> : null}
          <Text variant="label" numeric>
            {t("eyebrow", {
              step: index + 1,
              total: ONBOARDING_STEPS.length,
              name: t(`steps.${step}.name`),
            })}
          </Text>
          <Text variant="page">
            <FocusTarget ref={titleRef}>{t(`steps.${step}.title`)}</FocusTarget>
          </Text>
          <Text variant="body">{t(`steps.${step}.description`)}</Text>
        </div>
        <div key={step} {...stylex.props(styles.body)}>
          <StepBody
            step={step}
            page={page}
            trackerProjects={trackerProjects}
            actions={actions}
            workerSilent={workerSilent}
          />
        </div>
        <div {...stylex.props(styles.footer)}>
          {index > 0 ? (
            <Button variant="secondary" onClick={() => onStep(index - 1)}>
              {t("back")}
            </Button>
          ) : null}
          <div {...stylex.props(styles.footerEnd)}>
            {passed ? null : (
              <Text variant="meta" id={lockedId}>
                {t("nextLocked")}
              </Text>
            )}
            <Button
              variant={passed ? "primary" : "secondary"}
              disabled={!passed}
              {...(passed ? {} : { "aria-describedby": lockedId })}
              onClick={() => (last ? onFinish() : onStep(index + 1))}
            >
              {last ? t("finish") : t("next")}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

function StepList({
  page,
  index,
  onStep,
}: {
  page: SettingsPage;
  index: number;
  onStep: (index: number) => void;
}) {
  const t = useTranslations("onboarding");
  const reachable = reachableIndex(page);
  return (
    <StepNav label={t("stepsLabel")} title={t("heading")}>
      {ONBOARDING_STEPS.map((step, i) => {
        const current = i === index;
        const done = stepPassed(page, step);
        return (
          <StepNavItem
            key={step}
            number={i + 1}
            name={t(`steps.${step}.name`)}
            state={current ? "current" : done ? "done" : "todo"}
            doneLabel={t("stepDone")}
            {...(i <= reachable && !current ? { onSelect: () => onStep(i) } : {})}
          />
        );
      })}
    </StepNav>
  );
}

function FocusTarget({ ref, children }: { ref: Ref<HTMLSpanElement>; children: ReactNode }) {
  return (
    <span ref={ref} tabIndex={-1} {...stylex.props(focusStyles.ring)}>
      {children}
    </span>
  );
}

function useFocusWhenAdded(count: number): RefObject<HTMLSpanElement | null> {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useRef(count);
  useEffect(() => {
    if (count > seen.current) ref.current?.focus();
    seen.current = count;
  }, [count]);
  return ref;
}

function ExternalMark() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

function ExternalLink({
  href,
  children,
  button = false,
}: {
  href: string;
  children: ReactNode;
  button?: boolean;
}) {
  const t = useTranslations("onboarding");
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      {...(button ? { "data-variant": "secondary" } : {})}
      {...stylex.props(...(button ? buttonStyles("secondary") : linkStyles("action")))}
    >
      {children}
      <ExternalMark />
      <VisuallyHidden>{t("externalLink")}</VisuallyHidden>
    </a>
  );
}

function SummaryRow({
  title,
  meta,
  mono = false,
  children,
}: {
  title: ReactNode;
  meta: ReactNode;
  mono?: boolean;
  children?: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.summary)}>
      <DoneMark />
      <span {...stylex.props(styles.summaryText)}>
        <Text variant="title">{title}</Text>
        <Text variant="meta" mono={mono} truncate>
          {meta}
        </Text>
      </span>
      {children === undefined ? null : (
        <span {...stylex.props(styles.summaryActions)}>{children}</span>
      )}
    </div>
  );
}

function useEditToggle() {
  const [editing, setEditing] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const close = useCallback(() => setEditing(false), []);
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    toggleRef.current?.focus();
  }, [editing]);
  return {
    editing,
    toggleRef,
    toggle: () => setEditing((open) => !open),
    close,
    done: () => {
      refocus.current = true;
      setEditing(false);
    },
  };
}

function ToggleButton({ edit, label }: { edit: ReturnType<typeof useEditToggle>; label: string }) {
  const t = useTranslations("onboarding");
  return (
    <Button
      ref={edit.toggleRef}
      variant="secondary"
      aria-expanded={edit.editing}
      onClick={edit.toggle}
    >
      {edit.editing ? t("close") : label}
    </Button>
  );
}

function StepBody({
  step,
  page,
  trackerProjects,
  actions,
  workerSilent,
}: {
  step: OnboardingStep;
  page: SettingsPage;
  trackerProjects: ConnectionProjects[];
  actions: OnboardingActions;
  workerSilent: boolean;
}) {
  switch (step) {
    case "tracker":
      return <TrackerStep connections={page.install.connections} actions={actions} />;
    case "github":
      return <GitHubStep saved={page.install.githubToken} actions={actions} />;
    case "runner":
      return (
        <RunnerStep runners={page.install.runners} actions={actions} workerSilent={workerSilent} />
      );
    case "workspace":
      return <WorkspaceStep page={page} trackerProjects={trackerProjects} actions={actions} />;
    case "mapping":
      return page.workspace === null ? null : (
        <MappingStep workspace={page.workspace} page={page} actions={actions} />
      );
  }
}

function TrackerStep({
  connections,
  actions,
}: {
  connections: TrackerConnectionView[];
  actions: SettingsActions;
}) {
  const added = useFocusWhenAdded(connections.length);
  const newest = connections.at(-1)?.id;
  return (
    <>
      <ul {...stylex.props(styles.list)}>
        {connections.length === 0 ? (
          <li key="new">
            <Card>
              <TrackerKeyForm connection={null} actions={actions} />
            </Card>
          </li>
        ) : (
          connections.map((connection) => (
            <li key={connection.id}>
              <TrackerConnectionItem
                connection={connection}
                actions={actions}
                titleRef={connection.id === newest ? added : undefined}
              />
            </li>
          ))
        )}
      </ul>
      <WebhookExplainer />
    </>
  );
}

function TrackerConnectionItem({
  connection,
  actions,
  titleRef,
}: {
  connection: TrackerConnectionView;
  actions: SettingsActions;
  titleRef: Ref<HTMLSpanElement> | undefined;
}) {
  const t = useTranslations("onboarding");
  const edit = useEditToggle();
  return (
    <Card>
      <SummaryRow
        title={
          titleRef === undefined ? (
            connection.name
          ) : (
            <FocusTarget ref={titleRef}>{connection.name}</FocusTarget>
          )
        }
        meta={t("tracker.checked")}
      >
        <ToggleButton edit={edit} label={t("edit")} />
      </SummaryRow>
      {edit.editing ? (
        <TrackerKeyForm connection={connection} actions={actions} onDone={edit.done} />
      ) : null}
    </Card>
  );
}

function TrackerKeyForm({
  connection,
  actions,
  onDone,
}: {
  connection: TrackerConnectionView | null;
  actions: SettingsActions;
  onDone?: () => void;
}) {
  const t = useTranslations("onboarding.tracker");
  const ts = useTranslations("settings");
  const [apiKey, setApiKey] = useState("");
  const submit = useSubmit();
  const isNew = connection === null;
  const ready = apiKey.trim() !== "";
  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        submit.run(
          () =>
            actions.saveConnection({
              ...(connection === null ? {} : { id: connection.id }),
              apiKey: apiKey.trim(),
              webhookSecret: "",
            }),
          isNew ? ts("connections.added") : ts("saved"),
          () => {
            setApiKey("");
            onDone?.();
          },
        );
      }}
    >
      <Field
        label={ts("connections.apiKey")}
        description={isNew ? t("keyDescription") : t("keyDescriptionEdit")}
      >
        <Input
          name="apiKey"
          {...passwordManagerIgnoredSecretProps}
          value={apiKey}
          onValueChange={setApiKey}
          placeholder={t("keyPlaceholder")}
          mono
        />
      </Field>
      <div {...stylex.props(surfaceStyles("inset"), textStyles("ui"), styles.insetStack)}>
        <Text variant="title">{t("guideTitle")}</Text>
        <ol {...stylex.props(styles.bullets, styles.decimal)}>
          <li>{t("guideStepOpen")}</li>
          <li>{t("guideStepCreate")}</li>
          <li>{t("guideStepPaste")}</li>
        </ol>
        <span>
          <ExternalLink href={LINEAR_API_KEY_URL}>{t("guideLink")}</ExternalLink>
        </span>
      </div>
      <SubmitError state={submit.state} />
      <Actions>
        <Button
          variant={isNew ? "primary" : "secondary"}
          type="submit"
          disabled={submit.sending || !ready}
        >
          {submit.sending ? ts("connections.checking") : t("check")}
        </Button>
      </Actions>
    </form>
  );
}

function WebhookExplainer() {
  const t = useTranslations("onboarding.webhook");
  return (
    <Disclosure summary={t("question")}>
      <p {...stylex.props(styles.para)}>{t("answer")}</p>
      <div {...stylex.props(styles.compare)}>
        <div {...stylex.props(surfaceStyles("inset"), textStyles("ui"), styles.insetStack)}>
          <Text variant="title">{t("withoutTitle")}</Text>
          <span>{t("withoutBody")}</span>
        </div>
        <div {...stylex.props(surfaceStyles("inset"), textStyles("ui"), styles.insetStack)}>
          <Text variant="title">{t("withTitle")}</Text>
          <span>{t("withBody")}</span>
        </div>
      </div>
      <p {...stylex.props(styles.para)}>{t("retry")}</p>
      <p {...stylex.props(styles.para)}>{t("stopped")}</p>
      <p {...stylex.props(styles.para)}>{t("address")}</p>
    </Disclosure>
  );
}

function GitHubStep({ saved, actions }: { saved: boolean; actions: SettingsActions }) {
  const t = useTranslations("onboarding.github");
  const edit = useEditToggle();
  const added = useFocusWhenAdded(saved ? 1 : 0);
  if (!saved) {
    return (
      <>
        <GitHubGuide />
        <Card>
          <GitHubTokenForm actions={actions} primary />
        </Card>
      </>
    );
  }
  return (
    <>
      <Card>
        <SummaryRow
          title={<FocusTarget ref={added}>{t("saved")}</FocusTarget>}
          meta={t("savedMeta")}
        >
          <ToggleButton edit={edit} label={t("change")} />
        </SummaryRow>
        {edit.editing ? (
          <GitHubTokenForm actions={actions} primary={false} onDone={edit.done} />
        ) : null}
      </Card>
      {edit.editing ? <GitHubGuide /> : null}
    </>
  );
}

function GitHubGuide() {
  const t = useTranslations("onboarding.github");
  const titleId = useId();
  const steps: ReactNode[] = [
    t("guideStepToken"),
    t("guideStepOwner"),
    t("guideStepRepos"),
    <div key="permissions" {...stylex.props(styles.stackTight)}>
      <span>{t("guideStepPermissions")}</span>
      <span {...stylex.props(styles.permission)}>
        <Chip strong>{t("required")}</Chip>
        <Text variant="ui" tone="strong">
          {t("permissionPullRequests")}
        </Text>
        <Text variant="meta">{t("permissionPullRequestsNote")}</Text>
      </span>
      <span {...stylex.props(styles.permission)}>
        <Chip>{t("optional")}</Chip>
        <Text variant="ui" tone="strong">
          {t("permissionActions")}
        </Text>
        <Text variant="meta">{t("permissionActionsNote")}</Text>
      </span>
    </div>,
    t("guideStepPaste"),
  ];
  return (
    <section aria-labelledby={titleId} {...stylex.props(surfaceStyles("card"), styles.guide)}>
      <div {...stylex.props(styles.cardHeader)}>
        <Text variant="panel" as="h2" id={titleId}>
          {t("guideTitle")}
        </Text>
        <ExternalLink href={GITHUB_TOKEN_URL} button>
          {t("guideLink")}
        </ExternalLink>
      </div>
      <NumberedList items={steps} />
    </section>
  );
}

function GitHubTokenForm({
  actions,
  primary,
  onDone,
}: {
  actions: SettingsActions;
  primary: boolean;
  onDone?: () => void;
}) {
  const t = useTranslations("onboarding.github");
  const ts = useTranslations("settings");
  const [token, setToken] = useState("");
  const submit = useSubmit();
  const ready = token.trim() !== "";
  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        submit.run(
          () => actions.saveGitHubToken({ token: token.trim() }),
          ts("saved"),
          () => {
            setToken("");
            onDone?.();
          },
        );
      }}
    >
      <Field label={ts("github.token")} description={t("tokenDescription")}>
        <Input
          name="token"
          {...passwordManagerIgnoredSecretProps}
          value={token}
          onValueChange={setToken}
          placeholder={t("tokenPlaceholder")}
          mono
        />
      </Field>
      <SubmitError state={submit.state} />
      <Actions>
        <Button
          variant={primary ? "primary" : "secondary"}
          type="submit"
          disabled={submit.sending || !ready}
        >
          {submit.sending ? ts("saving") : ts("github.save")}
        </Button>
      </Actions>
    </form>
  );
}

function RunnerStep({
  runners,
  actions,
  workerSilent,
}: {
  runners: RunnerSettingsView[];
  actions: SettingsActions;
  workerSilent: boolean;
}) {
  const added = useFocusWhenAdded(runners.length);
  const newest = runners.at(-1)?.id;
  const stepPassedHere = runners.some(runnerPassed);
  return (
    <ul {...stylex.props(styles.list)}>
      {runners.length === 0 ? (
        <li key="new" {...stylex.props(styles.item)}>
          <Card>
            <RunnerBefore />
          </Card>
          <Card>
            <RunnerForm runner={null} actions={actions} />
          </Card>
        </li>
      ) : (
        runners.map((runner) => (
          <li key={runner.id} {...stylex.props(styles.item)}>
            <RunnerItem
              runner={runner}
              actions={actions}
              workerSilent={workerSilent}
              focusRef={runner.id === newest ? added : undefined}
              primary={!stepPassedHere && runner.id === newest}
            />
          </li>
        ))
      )}
    </ul>
  );
}

function RunnerItem({
  runner,
  actions,
  workerSilent,
  focusRef,
  primary,
}: {
  runner: RunnerSettingsView;
  actions: SettingsActions;
  workerSilent: boolean;
  focusRef: RefObject<HTMLSpanElement | null> | undefined;
  primary: boolean;
}) {
  const t = useTranslations("onboarding");
  const ts = useTranslations("settings.runners");
  const own = useRef<HTMLSpanElement>(null);
  const titleRef = focusRef ?? own;
  const edit = useEditToggle();
  const recheck = useSubmit();
  const focusAfterRecheck = useRef(false);
  const passed = runnerPassed(runner);
  const shownPassed = useRef(passed);
  const closeEdit = edit.close;
  useEffect(() => {
    if (shownPassed.current === passed) return;
    shownPassed.current = passed;
    if (!passed) closeEdit();
    const active = document.activeElement;
    const lost = focusAfterRecheck.current || active === null || active === document.body;
    focusAfterRecheck.current = false;
    if (lost) titleRef.current?.focus();
  }, [passed, titleRef, closeEdit]);

  if (passed && runner.check?.status === "done") {
    return (
      <Card label={t("runner.checkTitle", { name: runner.name })}>
        <SummaryRow
          title={
            <FocusTarget ref={titleRef}>{t("runner.ready", { name: runner.name })}</FocusTarget>
          }
          meta={t("runner.target", { sshTarget: runner.sshTarget, capacity: runner.capacity })}
          mono
        >
          <Button
            variant="secondary"
            disabled={recheck.sending}
            onClick={() => {
              focusAfterRecheck.current = true;
              recheck.run(() => actions.recheckRunner({ id: runner.id }), ts("checkRequested"));
            }}
          >
            {recheck.sending ? ts("checking") : ts("recheck")}
          </Button>
          <ToggleButton edit={edit} label={t("edit")} />
        </SummaryRow>
        <SubmitError state={recheck.state} />
        <RunnerChecklist
          version={runner.check.version}
          prerequisites={runner.check.prerequisites}
        />
        {edit.editing ? <RunnerForm runner={runner} actions={actions} /> : null}
      </Card>
    );
  }

  return (
    <>
      <Card>
        <RunnerForm runner={runner} actions={actions} />
      </Card>
      <Card>
        <PanelBlock
          title={
            <FocusTarget ref={titleRef}>
              {t("runner.checkTitle", { name: runner.name })}
            </FocusTarget>
          }
        >
          <div {...stylex.props(styles.stack)}>
            <RunnerCheck
              runner={runner}
              actions={actions}
              workerSilent={workerSilent}
              primary={primary}
            />
            <RunnerGuide runner={runner} />
          </div>
        </PanelBlock>
      </Card>
    </>
  );
}

function RunnerChecklist({
  version,
  prerequisites,
}: {
  version: string | null;
  prerequisites: PrerequisiteView[];
}) {
  const t = useTranslations("onboarding.runner");
  const tc = useTranslations("settings.runners.check");
  const tPush = useTranslations("domain.pushCheck");
  const prerequisiteName = usePrerequisiteName();
  const pushText = usePushSummaryText();
  const push = summarizePushChecks(prerequisites);
  const pushPassed = push.total > 0 && push.passed === push.total;
  return (
    <div {...stylex.props(styles.stack)}>
      <Checklist label={t("checklist")}>
        <ChecklistItem done label={tc("satisfied")}>
          {version === null ? tc("online") : tc("onlineVersion", { version })}
        </ChecklistItem>
        {runnerWideChecks(prerequisites).map((prerequisite) => (
          <ChecklistItem
            key={prerequisite.id}
            done={prerequisite.satisfied === true}
            label={prerequisite.satisfied === true ? tc("satisfied") : tc("unknown")}
          >
            {prerequisiteName(prerequisite)}
            {prerequisite.satisfied === true ? null : <Text variant="meta">{tc("unknown")}</Text>}
          </ChecklistItem>
        ))}
        <ChecklistItem done={pushPassed} label={pushPassed ? tc("satisfied") : t("pushWarning")}>
          {tPush("name")} · {pushText(push)}
        </ChecklistItem>
      </Checklist>
      <RunnerPushWarning push={push} />
    </div>
  );
}

function RunnerPushWarning({ push }: { push: PushSummary | null }) {
  const t = useTranslations("onboarding.runner");
  if (push === null || !pushNeedsWarning(push)) return null;
  return (
    <div role="status" {...stylex.props(styles.stack)}>
      <Text variant="ui" as="p" tone="strong">
        {push.total === 0 ? t("pushNoneTitle") : t("pushWarningTitle")}
      </Text>
      <Text variant="body">{push.total === 0 ? t("pushNoneBody") : t("pushWarningBody")}</Text>
      <PushProblems summary={push} />
    </div>
  );
}

function RunnerBefore() {
  const t = useTranslations("onboarding.runner");
  return (
    <PanelBlock title={t("beforeTitle")}>
      <div {...stylex.props(styles.stack)}>
        <Text variant="body">{t("beforeService")}</Text>
        <Command value={serviceInstallTemplate(t("pathPlaceholder"))} />
        <Text variant="body">{t("beforeAuth")}</Text>
      </div>
    </PanelBlock>
  );
}

function RunnerGuide({ runner }: { runner: RunnerSettingsView }) {
  const t = useTranslations("onboarding.runner");
  const runnerError = useRunnerErrorName();
  const check = runner.check;
  const checkingText = useCheckingText(
    check?.status === "pending" ? (check.requestedAgoMs ?? 0) : null,
  );
  if (check === null || check.status === "pending") {
    return check === null ? null : <Text variant="meta">{checkingText ?? t("waiting")}</Text>;
  }
  if (check.status !== "done") return null;
  const problems = runnerProblems(runner);
  const known = problems.service || problems.error !== null;
  if (!known && !check.online) {
    return (
      <Text variant="ui" as="p" tone="problem" role="alert">
        {t("offline")}
      </Text>
    );
  }
  return (
    <div role="alert" {...stylex.props(styles.stack)}>
      {problems.service ? (
        <div {...stylex.props(styles.stack)}>
          <Text variant="ui" as="p" tone="problem">
            {t("serviceTitle")}
          </Text>
          <Text variant="body">{t("serviceBody")}</Text>
          <Command value={serviceInstallCommand(runner.orcaPath)} />
          <Text variant="meta">{t("serviceLinux")}</Text>
        </div>
      ) : null}
      {problems.error === null ? null : (
        <div {...stylex.props(styles.stack)}>
          <Text variant="ui" as="p" tone="problem">
            {t("errorTitle")}
          </Text>
          <Text variant="body">{t("errorBody", { reason: runnerError(problems.error) })}</Text>
        </div>
      )}
      {problems.error === null ? <RunnerPushWarning push={problems.push} /> : null}
      {known ? null : (
        <div {...stylex.props(styles.stack)}>
          <Text variant="ui" as="p" tone="problem">
            {t("otherTitle")}
          </Text>
          <Text variant="body">{t("otherBody")}</Text>
        </div>
      )}
    </div>
  );
}

function Command({ value }: { value: string }) {
  const words = value.split(" ");
  return (
    <CodeBlock tone="command">
      {words.map((word, i) => (
        <span key={i} {...stylex.props(styles.word)}>
          {i === 0 ? word : ` ${word}`}
        </span>
      ))}
    </CodeBlock>
  );
}

function WorkspaceStep({
  page,
  trackerProjects,
  actions,
}: {
  page: SettingsPage;
  trackerProjects: ConnectionProjects[];
  actions: OnboardingActions;
}) {
  const t = useTranslations("onboarding");
  const workspace = page.workspace;
  const passed = stepPassed(page, "workspace");
  const added = useFocusWhenAdded(passed ? 1 : 0);
  const edit = useEditToggle();
  if (workspace === null || !passed) {
    return (
      <Card>
        <WorkspaceForm workspace={workspace} groups={trackerProjects} actions={actions} primary />
      </Card>
    );
  }
  return (
    <Card>
      <SummaryRow
        title={
          <FocusTarget ref={added}>
            {t("workspace.current", { name: workspace.general.name })}
          </FocusTarget>
        }
        meta={t("workspace.summary", {
          count: workspace.bound.length,
          names: workspace.bound.map((b) => b.project.name).join(", "),
        })}
      >
        <ToggleButton edit={edit} label={t("edit")} />
      </SummaryRow>
      {edit.editing ? (
        <WorkspaceForm
          workspace={workspace}
          groups={trackerProjects}
          actions={actions}
          primary={false}
          onDone={edit.done}
        />
      ) : null}
    </Card>
  );
}

const projectKey = (connectionId: TrackerConnectionId, projectId: TrackerProjectId) =>
  `${connectionId}\n${projectId}`;

function WorkspaceForm({
  workspace,
  groups,
  actions,
  primary,
  onDone,
}: {
  workspace: WorkspaceSettings | null;
  groups: ConnectionProjects[];
  actions: OnboardingActions;
  primary: boolean;
  onDone?: () => void;
}) {
  const t = useTranslations("onboarding.workspace");
  const ts = useTranslations("settings");
  const reason = useReason();
  const [name, setName] = useState(workspace?.general.name ?? "");
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const submit = useSubmit();
  const hasProjects = picked.size > 0 || (workspace?.bound.length ?? 0) > 0;
  const ready = name.trim() !== "" && hasProjects;
  const legendId = useId();
  const toggle = (key: string, on: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        const projects = groups.flatMap((group) => {
          const connectionId = toTrackerConnectionId(group.connection.id);
          return group.projects.flatMap((project) => {
            const projectId = toTrackerProjectId(project.id);
            return picked.has(projectKey(connectionId, projectId))
              ? [{ connectionId, projectId, name: project.name }]
              : [];
          });
        });
        submit.run(
          () => actions.setUpWorkspace({ name: name.trim(), projects }),
          workspace === null ? t("created") : ts("saved"),
          () => {
            setPicked(new Set());
            onDone?.();
          },
        );
      }}
    >
      <Field label={t("name")}>
        <Input
          name="name"
          value={name}
          onValueChange={setName}
          placeholder={t("namePlaceholder")}
          autoComplete="off"
        />
      </Field>
      <fieldset aria-labelledby={legendId} {...stylex.props(styles.fieldset)}>
        <Text variant="ui" id={legendId}>
          {t("projects")}
        </Text>
        <Text variant="meta">{t("projectsHint")}</Text>
        {groups.length === 0 ? (
          <Text variant="meta">{ts("projects.noConnections")}</Text>
        ) : (
          groups.map((group) => (
            <div key={group.connection.id} {...stylex.props(surfaceStyles("inset"), styles.group)}>
              <span {...stylex.props(textStyles("label"), styles.groupTitle)}>
                {group.connection.name}
              </span>
              {group.error === null ? null : (
                <Text variant="ui" as="p" tone="problem">
                  {ts("projects.listFailed", { reason: reason(group.error) })}
                </Text>
              )}
              {group.projects.length === 0 && group.error === null ? (
                <Text variant="meta">{ts("projects.empty")}</Text>
              ) : null}
              {group.projects.map((project) => {
                const key = projectKey(
                  toTrackerConnectionId(group.connection.id),
                  toTrackerProjectId(project.id),
                );
                const owner = project.owner;
                switch (owner.kind) {
                  case "this":
                    return (
                      <Checkbox
                        key={key}
                        label={project.name}
                        description={t("inThis")}
                        checked
                        disabled
                        onCheckedChange={() => {}}
                      />
                    );
                  case "other":
                    return (
                      <Checkbox
                        key={key}
                        label={project.name}
                        description={ts("projects.inOther", { workspace: owner.workspace.name })}
                        checked={false}
                        disabled
                        onCheckedChange={() => {}}
                      />
                    );
                  case "free":
                    return (
                      <Checkbox
                        key={key}
                        label={project.name}
                        checked={picked.has(key)}
                        onCheckedChange={(on) => toggle(key, on)}
                      />
                    );
                }
              })}
            </div>
          ))
        )}
      </fieldset>
      <SubmitError state={submit.state} />
      <Actions>
        <Button
          variant={primary ? "primary" : "secondary"}
          type="submit"
          disabled={submit.sending || !ready}
        >
          {workspace === null
            ? submit.sending
              ? t("creating")
              : t("create")
            : submit.sending
              ? ts("saving")
              : ts("save")}
        </Button>
      </Actions>
    </form>
  );
}

function useSyncedSave<V>({
  saved,
  savedKey,
  send,
  onSaved,
}: {
  saved: V;
  savedKey: string;
  send: (value: V) => Promise<ActionResult>;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(saved);
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const latest = useRef({ saved, send, onSaved });
  useEffect(() => {
    latest.current = { saved, send, onSaved };
  });
  const [saver] = useState(() =>
    createSerialSaver<V>({
      send: (value) => latest.current.send(value),
      revert: () => setDraft(latest.current.saved),
      onState: setState,
      onSaved: () => latest.current.onSaved(),
    }),
  );
  const sending = state.kind === "sending";
  useEffect(() => {
    if (!sending) setDraft(latest.current.saved);
  }, [savedKey, sending]);
  return {
    draft,
    setDraft,
    state,
    choose: (value: V) => {
      setDraft(value);
      saver.choose(value);
    },
  };
}

function MappingStep({
  workspace,
  page,
  actions,
}: {
  workspace: WorkspaceSettings;
  page: SettingsPage;
  actions: SettingsActions;
}) {
  const t = useTranslations("onboarding.mapping");
  const ts = useTranslations("settings");
  const missing = missingMappingParts(workspace);
  const [saves, setSaves] = useState(0);
  const announce = useCallback(() => setSaves((count) => count + 1), []);
  return (
    <>
      {page.runnerProjects.length === 0 ? (
        <Text variant="meta">{ts("mapping.noRunnerProjects")}</Text>
      ) : null}
      <DataTable label={t("tableLabel")} framed>
        <DataTableHead>
          <DataTableHeader>{t("trackerProject")}</DataTableHeader>
          <DataTableHeader>{t("runnerProject")}</DataTableHeader>
          <DataTableHeader>{t("agent")}</DataTableHeader>
          <DataTableHeader>{t("inProgress")}</DataTableHeader>
          <DataTableHeader shrink>
            <VisuallyHidden>{t("rowState")}</VisuallyHidden>
          </DataTableHeader>
        </DataTableHead>
        <DataTableBody>
          {workspace.bound.map((bound) => (
            <MappingRow
              key={`${bound.connection.id}/${bound.project.id}`}
              ws={workspace.general.id}
              bound={bound}
              runnerProjects={page.runnerProjects}
              agents={page.agents}
              actions={actions}
              onSaved={announce}
            />
          ))}
        </DataTableBody>
      </DataTable>
      <Text variant="meta">{ts("mapping.permissionHint")}</Text>
      {workspace.labels.map((label) => (
        <LabelRow
          key={label.connection.id}
          ws={workspace.general.id}
          label={label}
          actions={actions}
          onSaved={announce}
        />
      ))}
      <p role="status" aria-live="polite" {...stylex.props(visuallyHiddenStyles.hidden)}>
        {saves === 0 ? null : <span key={saves}>{ts("saved")}</span>}
      </p>
      <div {...stylex.props(styles.stack)}>
        {missing.length === 0 ? (
          <Text variant="ui" as="p" tone="strong">
            {t("ready")}
          </Text>
        ) : (
          <>
            <Text variant="ui" as="p" tone="strong">
              {t("missingTitle")}
            </Text>
            <ul {...stylex.props(textStyles("ui"), styles.bullets)}>
              {missing.map((part) => (
                <li key={part}>{t(`missing.${part}`)}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

interface MappingChoice {
  runnerProject: RunnerProjectId | null;
  agent: AgentId | null;
}

function MappingRow({
  ws,
  bound,
  runnerProjects,
  agents,
  actions,
  onSaved,
}: {
  ws: WorkspaceId;
  bound: BoundProject;
  runnerProjects: Choice[];
  agents: string[];
  actions: SettingsActions;
  onSaved: () => void;
}) {
  const t = useTranslations("onboarding.mapping");
  const ts = useTranslations("settings");
  const reason = useReason();
  const agentName = useAgentName();
  const hintId = useId();
  const target = { ws, connectionId: bound.connection.id, projectId: bound.project.id };
  const savedProject =
    bound.mapping === null ? null : toRunnerProjectId(bound.mapping.runnerProject);
  const savedAgent = bound.mapping === null ? null : toAgentId(bound.mapping.agent);
  const saveMapping = (nextProject: RunnerProjectId | null, nextAgent: AgentId | null) =>
    nextProject === null || nextAgent === null
      ? Promise.resolve<ActionResult>({ ok: true })
      : actions.saveMapping({
          ...target,
          runnerProjectId: nextProject,
          agentId: nextAgent,
          model: bound.mapping?.model ?? "",
        });
  const mapping = useSyncedSave<MappingChoice>({
    saved: { runnerProject: savedProject, agent: savedAgent },
    savedKey: `${savedProject ?? ""}\n${savedAgent ?? ""}`,
    send: (choice) => saveMapping(choice.runnerProject, choice.agent),
    onSaved,
  });
  const savedState =
    bound.inProgressStateId === null ? null : toTrackerStateId(bound.inProgressStateId);
  const progress = useSyncedSave<TrackerStateId | null>({
    saved: savedState,
    savedKey: bound.inProgressStateId ?? "",
    send: (stateId) =>
      stateId === null
        ? Promise.resolve<ActionResult>({ ok: true })
        : actions.saveInProgress({ ...target, stateId }),
    onSaved,
  });
  const pick = (next: MappingChoice) => {
    if (next.runnerProject === null || next.agent === null) mapping.setDraft(next);
    else mapping.choose(next);
  };
  const { runnerProject, agent } = mapping.draft;
  const project = bound.project.name;
  const done = mappingRowComplete(bound);
  const missingPair =
    runnerProject !== null && agent === null
      ? "agent"
      : runnerProject === null && agent !== null
        ? "runnerProject"
        : null;
  const failed =
    mapping.state.kind === "failed" || progress.state.kind === "failed" || !bound.states.ok;
  return (
    <Fragment>
      <DataTableRow>
        <DataTableRowHeader>
          <span {...stylex.props(styles.rowHeaderText)}>
            <Text variant="ui" tone="strong">
              {project}
            </Text>
            <Text variant="meta">{bound.connection.name}</Text>
          </span>
        </DataTableRowHeader>
        <DataTableCell wide>
          <Select
            aria-label={t("cellLabel", { project, column: t("runnerProject") })}
            {...(missingPair === "runnerProject" ? { "aria-describedby": hintId } : {})}
            options={withCurrent(
              runnerProjects.map((p) => ({ value: p.id, label: p.name })),
              bound.mapping?.runnerProject,
            )}
            value={runnerProject}
            onValueChange={(value) => pick({ runnerProject: toRunnerProjectId(value), agent })}
            placeholder={ts("mapping.choose")}
          />
        </DataTableCell>
        <DataTableCell wide>
          <Select
            aria-label={t("cellLabel", { project, column: t("agent") })}
            {...(missingPair === "agent" ? { "aria-describedby": hintId } : {})}
            options={agents.map((a) => ({ value: a, label: agentName(a) }))}
            value={agent}
            onValueChange={(value) => pick({ runnerProject, agent: toAgentId(value) })}
            placeholder={ts("mapping.choose")}
          />
        </DataTableCell>
        <DataTableCell wide>
          <Select
            aria-label={t("cellLabel", { project, column: t("inProgress") })}
            options={withCurrent(
              bound.states.ok
                ? bound.states.items.map((s) => ({ value: s.id, label: s.name }))
                : [],
              bound.inProgressStateId,
            )}
            value={progress.draft}
            onValueChange={(value) => progress.choose(toTrackerStateId(value))}
            placeholder={ts("mapping.choose")}
          />
        </DataTableCell>
        <DataTableCell>
          <CheckTick done={done} label={done ? t("rowDone") : t("rowEmpty")} />
        </DataTableCell>
      </DataTableRow>
      {failed || missingPair !== null ? (
        <DataTableRow divided={false}>
          <DataTableCell colSpan={5}>
            <div {...stylex.props(styles.stackTight)}>
              {missingPair === null ? null : (
                <Text variant="ui" id={hintId}>
                  {missingPair === "agent" ? t("needAgent") : t("needRunnerProject")}
                </Text>
              )}
              <SubmitError state={mapping.state} />
              <SubmitError state={progress.state} />
              {bound.states.ok ? null : (
                <Text variant="ui" as="p" tone="problem">
                  {ts("progress.listFailed", { reason: reason(bound.states.error) })}
                </Text>
              )}
            </div>
          </DataTableCell>
        </DataTableRow>
      ) : null}
    </Fragment>
  );
}

function LabelRow({
  ws,
  label,
  actions,
  onSaved,
}: {
  ws: WorkspaceId;
  label: ConnectionLabel;
  actions: SettingsActions;
  onSaved: () => void;
}) {
  const t = useTranslations("onboarding.mapping");
  const ts = useTranslations("settings");
  const reason = useReason();
  const save = useSyncedSave<LabelId | null>({
    saved: label.labelId === null ? null : toLabelId(label.labelId),
    savedKey: label.labelId ?? "",
    send: (labelId) =>
      labelId === null
        ? Promise.resolve<ActionResult>({ ok: true })
        : actions.saveLabel({ ws, connectionId: label.connection.id, labelId }),
    onSaved,
  });
  const options = label.labels.ok
    ? label.labels.items.map((l) => ({ value: l.id, label: l.name }))
    : [];
  const current = label.labelId;
  const allOptions =
    current === null || options.some((o) => o.value === current)
      ? options
      : [...options, { value: current, label: ts("label.unknown", { id: current }) }];
  const done = label.labelId !== null;
  return (
    <Card>
      <div {...stylex.props(styles.labelRow)}>
        <span {...stylex.props(styles.labelText)}>
          <Text variant="ui" tone="strong">
            {t("labelTitle")} <Text variant="meta">· {label.connection.name}</Text>
          </Text>
          <Text variant="meta">{t("labelHint")}</Text>
        </span>
        <span {...stylex.props(styles.labelSelect)}>
          <Select
            aria-label={t("labelSelect", { connection: label.connection.name })}
            options={allOptions}
            value={save.draft}
            onValueChange={(value) => save.choose(toLabelId(value))}
            placeholder={ts("label.choose")}
          />
        </span>
        <CheckTick done={done} label={done ? t("rowDone") : t("rowEmpty")} />
      </div>
      {label.labels.ok ? null : (
        <Text variant="ui" as="p" tone="problem">
          {ts("label.listFailed", { reason: reason(label.labels.error) })}
        </Text>
      )}
      <SubmitError state={save.state} />
    </Card>
  );
}

const styles = stylex.create({
  page: {
    display: "grid",
    gridTemplateColumns: {
      default: `${size.stepNavWidth} minmax(0, ${size.stepContentWidth})`,
      [breakpoints.stepsStacked]: "minmax(0, 1fr)",
    },
    justifyContent: "center",
    columnGap: space.s10,
    rowGap: space.s6,
    minHeight: "100dvh",
    paddingTop: space.s10,
    paddingInline: space.s6,
    paddingBottom: space.s10,
    boxSizing: "border-box",
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
    minWidth: 0,
  },
  heading: { display: "flex", flexDirection: "column", gap: space.s2 },
  body: { display: "flex", flexDirection: "column", gap: space.s4 },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
  },
  footerEnd: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: space.s3,
    marginInlineStart: "auto",
  },
  form: { display: "flex", flexDirection: "column", gap: space.s4 },
  stack: { display: "flex", flexDirection: "column", gap: space.s3, margin: 0 },
  stackTight: { display: "flex", flexDirection: "column", gap: space.s2 },
  list: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
  },
  item: { display: "flex", flexDirection: "column", gap: space.s4 },
  bullets: {
    margin: 0,
    paddingInlineStart: space.s5,
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
  },
  decimal: { listStyleType: "decimal" },
  summary: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  summaryText: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    flexGrow: 1,
    minWidth: 0,
  },
  summaryActions: { display: "flex", flexWrap: "wrap", gap: space.s2, flexShrink: 0 },
  insetStack: { display: "flex", flexDirection: "column", gap: space.s2 },
  compare: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(${size.compareMinWidth}, 1fr))`,
    gap: space.s2,
  },
  para: { margin: 0 },
  guide: { display: "flex", flexDirection: "column", gap: space.s4 },
  cardHeader: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  permission: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: space.s2 },
  fieldset: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    minWidth: 0,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    paddingBlock: space.s2,
    paddingInline: space.s1,
  },
  groupTitle: { paddingTop: space.s1, paddingInline: space.s3 },
  rowHeaderText: { display: "flex", flexDirection: "column", gap: space.px2 },
  labelRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
  labelText: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    flexGrow: 1,
    flexBasis: size.labelTextMinWidth,
    minWidth: 0,
  },
  labelSelect: { flexGrow: 0, flexShrink: 1, flexBasis: size.labelSelectWidth, minWidth: 0 },
  word: { whiteSpace: "pre" },
});

import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  PanelBlock,
  Select,
  Text,
  buttonStyles,
} from "@factory/ui";
import {
  colors,
  fontSize,
  fontWeight,
  fonts,
  lineHeight,
  radius,
  space,
} from "@factory/ui/tokens.stylex";
import type { ReactNode, Ref, RefObject } from "react";
import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useAgentName, usePrerequisiteName } from "../labels";
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
  RunnerSettingsView,
  SettingsPage,
  TrackerConnectionView,
  WorkspaceSettings,
} from "../settings/model";
import {
  GITHUB_TOKEN_URL,
  LINEAR_API_KEY_URL,
  ONBOARDING_STEPS,
  mappingRowComplete,
  missingMappingParts,
  reachableIndex,
  runnerPassed,
  runnerProblems,
  serviceInstallCommand,
  serviceInstallTemplate,
  stepPassed,
} from "./model";
import type { OnboardingStep } from "./model";

export interface WorkspaceSetupInput {
  name: string;
  projects: Array<{ connectionId: string; projectId: string; name: string }>;
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
          <span {...stylex.props(styles.eyebrow)}>
            {t("eyebrow", {
              step: index + 1,
              total: ONBOARDING_STEPS.length,
              name: t(`steps.${step}.name`),
            })}
          </span>
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
              <span id={lockedId} {...stylex.props(styles.locked)}>
                {t("nextLocked")}
              </span>
            )}
            <button
              type="button"
              data-variant={passed ? "primary" : "secondary"}
              disabled={!passed}
              aria-describedby={passed ? undefined : lockedId}
              onClick={() => (last ? onFinish() : onStep(index + 1))}
              {...stylex.props(...buttonStyles(passed ? "primary" : "secondary", !passed))}
            >
              {last ? t("finish") : t("next")}
            </button>
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
    <nav aria-label={t("stepsLabel")} {...stylex.props(styles.nav)}>
      <span {...stylex.props(styles.brand)}>{t("heading")}</span>
      <ol {...stylex.props(styles.steps)}>
        {ONBOARDING_STEPS.map((step, i) => {
          const current = i === index;
          const done = stepPassed(page, step);
          const content: ReactNode = (
            <>
              <span
                {...stylex.props(
                  styles.marker,
                  done && styles.markerDone,
                  current && styles.markerCurrent,
                )}
              >
                {done && !current ? (
                  <>
                    <CheckMark />
                    <span {...stylex.props(styles.srOnly)}>{i + 1}</span>
                  </>
                ) : (
                  i + 1
                )}
              </span>
              <span>{t(`steps.${step}.name`)}</span>
              {done && !current ? (
                <span {...stylex.props(styles.srOnly)}>{t("stepDone")}</span>
              ) : null}
            </>
          );
          return (
            <li key={step}>
              {i <= reachable && !current ? (
                <button
                  type="button"
                  onClick={() => onStep(i)}
                  {...stylex.props(styles.step, styles.stepButton, done && styles.stepDone)}
                >
                  {content}
                </button>
              ) : (
                <span
                  aria-current={current ? "step" : undefined}
                  {...stylex.props(styles.step, current && styles.stepCurrent)}
                >
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function FocusTarget({ ref, children }: { ref: Ref<HTMLSpanElement>; children: ReactNode }) {
  return (
    <span ref={ref} tabIndex={-1} {...stylex.props(styles.focusTarget)}>
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

function CheckMark() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
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

function DoneCircle() {
  return (
    <span {...stylex.props(styles.marker, styles.markerDone, styles.doneCircle)}>
      <CheckMark />
    </span>
  );
}

function Tick({ done, label }: { done: boolean; label: string }) {
  return (
    <span role="img" aria-label={label} {...stylex.props(done ? styles.tick : styles.tickEmpty)}>
      {done ? <CheckMark /> : null}
    </span>
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
      {...stylex.props(...(button ? buttonStyles("secondary") : [styles.link]))}
    >
      {children}
      <ExternalMark />
      <span {...stylex.props(styles.srOnly)}>{t("externalLink")}</span>
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
      <DoneCircle />
      <span {...stylex.props(styles.summaryText)}>
        <span {...stylex.props(styles.summaryTitle)}>{title}</span>
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
      <Field label={ts("connections.apiKey")} description={t("keyDescription")}>
        <Input
          name="apiKey"
          {...passwordManagerIgnoredSecretProps}
          value={apiKey}
          onValueChange={setApiKey}
          placeholder={t("keyPlaceholder")}
          mono
        />
      </Field>
      <div {...stylex.props(styles.inset)}>
        <span {...stylex.props(styles.insetTitle)}>{t("guideTitle")}</span>
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
    <details {...stylex.props(styles.details)}>
      <summary {...stylex.props(styles.detailsSummary)}>{t("question")}</summary>
      <div {...stylex.props(styles.detailsBody)}>
        <p {...stylex.props(styles.para)}>{t("answer")}</p>
        <div {...stylex.props(styles.compare)}>
          <div {...stylex.props(styles.inset, styles.compareItem)}>
            <span {...stylex.props(styles.insetTitle)}>{t("withoutTitle")}</span>
            <span>{t("withoutBody")}</span>
          </div>
          <div {...stylex.props(styles.inset, styles.compareItem)}>
            <span {...stylex.props(styles.insetTitle)}>{t("withTitle")}</span>
            <span>{t("withBody")}</span>
          </div>
        </div>
        <p {...stylex.props(styles.para)}>{t("retry")}</p>
        <p {...stylex.props(styles.para)}>{t("address")}</p>
      </div>
    </details>
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
        <span {...stylex.props(styles.chip, styles.chipStrong)}>{t("required")}</span>
        <span {...stylex.props(styles.primaryText)}>{t("permissionPullRequests")}</span>
        <Text variant="meta">{t("permissionPullRequestsNote")}</Text>
      </span>
      <span {...stylex.props(styles.permission)}>
        <span {...stylex.props(styles.chip)}>{t("optional")}</span>
        <span {...stylex.props(styles.primaryText)}>{t("permissionActions")}</span>
        <Text variant="meta">{t("permissionActionsNote")}</Text>
      </span>
    </div>,
    t("guideStepPaste"),
  ];
  return (
    <section aria-labelledby={titleId} {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.cardHeader)}>
        <h2 id={titleId} {...stylex.props(styles.cardTitle)}>
          {t("guideTitle")}
        </h2>
        <ExternalLink href={GITHUB_TOKEN_URL} button>
          {t("guideLink")}
        </ExternalLink>
      </div>
      <ol {...stylex.props(styles.numbered)}>
        {steps.map((content, i) => (
          <li key={i} {...stylex.props(styles.numberedItem)}>
            <span aria-hidden="true" {...stylex.props(styles.marker, styles.numberedMarker)}>
              {i + 1}
            </span>
            <span {...stylex.props(styles.numberedBody)}>{content}</span>
          </li>
        ))}
      </ol>
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
  prerequisites: Array<{
    id: string;
    name: string;
    satisfied: boolean | null;
    project: string | null;
  }>;
}) {
  const t = useTranslations("onboarding.runner");
  const tc = useTranslations("settings.runners.check");
  const prerequisiteName = usePrerequisiteName();
  return (
    <ul aria-label={t("checklist")} {...stylex.props(styles.checklist)}>
      <li {...stylex.props(styles.checkItem)}>
        <Tick done label={tc("satisfied")} />
        {version === null ? tc("online") : tc("onlineVersion", { version })}
      </li>
      {prerequisites.map((prerequisite) => (
        <li key={prerequisite.id} {...stylex.props(styles.checkItem)}>
          <Tick
            done={prerequisite.satisfied === true}
            label={prerequisite.satisfied === true ? tc("satisfied") : tc("unknown")}
          />
          {prerequisiteName(prerequisite)}
          {prerequisite.satisfied === true ? null : <Text variant="meta">{tc("unknown")}</Text>}
        </li>
      ))}
    </ul>
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
  if (check === null || check.status === "pending") {
    return check === null ? null : <Text variant="meta">{t("waiting")}</Text>;
  }
  if (check.status !== "done") return null;
  const problems = runnerProblems(runner);
  const known =
    problems.service || problems.githubAuth || problems.error !== null || problems.pushUnchecked;
  if (!known && !check.online) {
    return (
      <p role="alert" {...stylex.props(styles.error)}>
        {t("offline")}
      </p>
    );
  }
  return (
    <div role="alert" {...stylex.props(styles.stack)}>
      {problems.service ? (
        <div {...stylex.props(styles.stack)}>
          <p {...stylex.props(styles.error)}>{t("serviceTitle")}</p>
          <Text variant="body">{t("serviceBody")}</Text>
          <Command value={serviceInstallCommand(runner.orcaPath)} />
          <Text variant="meta">{t("serviceLinux")}</Text>
        </div>
      ) : null}
      {problems.githubAuth ? (
        <div {...stylex.props(styles.stack)}>
          <p {...stylex.props(styles.error)}>{t("authTitle")}</p>
          <Text variant="body">{t("authBody")}</Text>
          <ul {...stylex.props(styles.bullets)}>
            <li>{t("authCauseToken")}</li>
            <li>{t("authCauseKeychain")}</li>
            <li>{t("authCauseSshKey")}</li>
          </ul>
        </div>
      ) : null}
      {problems.error === null ? null : (
        <div {...stylex.props(styles.stack)}>
          <p {...stylex.props(styles.error)}>{t("errorTitle")}</p>
          <Text variant="body">{t("errorBody", { reason: runnerError(problems.error) })}</Text>
        </div>
      )}
      {problems.pushUnchecked && problems.error === null ? (
        <div {...stylex.props(styles.stack)}>
          <p {...stylex.props(styles.error)}>{t("pushUncheckedTitle")}</p>
          <Text variant="body">{t("pushUncheckedBody")}</Text>
        </div>
      ) : null}
      {known ? null : (
        <div {...stylex.props(styles.stack)}>
          <p {...stylex.props(styles.error)}>{t("otherTitle")}</p>
          <Text variant="body">{t("otherBody")}</Text>
        </div>
      )}
    </div>
  );
}

function Command({ value }: { value: string }) {
  const words = value.split(" ");
  return (
    <code {...stylex.props(styles.command)}>
      {words.map((word, i) => (
        <span key={i} {...stylex.props(styles.word)}>
          {i === 0 ? word : ` ${word}`}
        </span>
      ))}
    </code>
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

const projectKey = (connectionId: string, projectId: string) => `${connectionId}\n${projectId}`;

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
        const projects = groups.flatMap((group) =>
          group.projects.flatMap((project) =>
            picked.has(projectKey(group.connection.id, project.id))
              ? [{ connectionId: group.connection.id, projectId: project.id, name: project.name }]
              : [],
          ),
        );
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
        <span id={legendId} {...stylex.props(styles.legend)}>
          {t("projects")}
        </span>
        <Text variant="meta">{t("projectsHint")}</Text>
        {groups.length === 0 ? (
          <Text variant="meta">{ts("projects.noConnections")}</Text>
        ) : (
          groups.map((group) => (
            <div key={group.connection.id} {...stylex.props(styles.group)}>
              <span {...stylex.props(styles.groupTitle)}>{group.connection.name}</span>
              {group.error === null ? null : (
                <p {...stylex.props(styles.error)}>
                  {ts("projects.listFailed", { reason: reason(group.error) })}
                </p>
              )}
              {group.projects.length === 0 && group.error === null ? (
                <Text variant="meta">{ts("projects.empty")}</Text>
              ) : null}
              {group.projects.map((project) => {
                const key = projectKey(group.connection.id, project.id);
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

function useAutoSave() {
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const run = (action: () => Promise<ActionResult>) => {
    setState({ kind: "sending" });
    action().then(
      (result) =>
        setState(result.ok ? { kind: "idle" } : { kind: "failed", reason: result.reason }),
      () => setState({ kind: "failed", reason: "unknown" }),
    );
  };
  return { state, run };
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
  const ts = useTranslations("settings.mapping");
  const missing = missingMappingParts(workspace);
  return (
    <>
      {page.runnerProjects.length === 0 ? (
        <Text variant="meta">{ts("noRunnerProjects")}</Text>
      ) : null}
      <div {...stylex.props(styles.tableBox)}>
        <table aria-label={t("tableLabel")} {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th scope="col" {...stylex.props(styles.th, styles.thFirst)}>
                {t("trackerProject")}
              </th>
              <th scope="col" {...stylex.props(styles.th)}>
                {t("runnerProject")}
              </th>
              <th scope="col" {...stylex.props(styles.th)}>
                {t("agent")}
              </th>
              <th scope="col" {...stylex.props(styles.th)}>
                {t("inProgress")}
              </th>
              <th scope="col" {...stylex.props(styles.th, styles.thLast)}>
                <span {...stylex.props(styles.srOnly)}>{t("rowState")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {workspace.bound.map((bound) => (
              <MappingRow
                key={`${bound.connection.id}/${bound.project.id}`}
                ws={workspace.general.id}
                bound={bound}
                runnerProjects={page.runnerProjects}
                agents={page.agents}
                actions={actions}
              />
            ))}
          </tbody>
        </table>
      </div>
      <Text variant="meta">{ts("permissionHint")}</Text>
      {workspace.labels.map((label) => (
        <LabelRow
          key={label.connection.id}
          ws={workspace.general.id}
          label={label}
          actions={actions}
        />
      ))}
      <div role="status" {...stylex.props(styles.stack)}>
        {missing.length === 0 ? (
          <p {...stylex.props(styles.ok)}>{t("ready")}</p>
        ) : (
          <>
            <p {...stylex.props(styles.ok)}>{t("missingTitle")}</p>
            <ul {...stylex.props(styles.bullets)}>
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

function MappingRow({
  ws,
  bound,
  runnerProjects,
  agents,
  actions,
}: {
  ws: string;
  bound: BoundProject;
  runnerProjects: Choice[];
  agents: string[];
  actions: SettingsActions;
}) {
  const t = useTranslations("onboarding.mapping");
  const ts = useTranslations("settings");
  const reason = useReason();
  const agentName = useAgentName();
  const [runnerProject, setRunnerProject] = useState(bound.mapping?.runnerProject ?? null);
  const [agent, setAgent] = useState(bound.mapping?.agent ?? null);
  const [stateId, setStateId] = useState(bound.inProgressStateId);
  const mapping = useAutoSave();
  const progress = useAutoSave();
  const target = { ws, connectionId: bound.connection.id, projectId: bound.project.id };
  const saveMapping = (nextProject: string | null, nextAgent: string | null) => {
    if (nextProject === null || nextAgent === null) return;
    mapping.run(() =>
      actions.saveMapping({
        ...target,
        runnerProjectId: nextProject,
        agentId: nextAgent,
        model: bound.mapping?.model ?? "",
      }),
    );
  };
  const project = bound.project.name;
  const done = mappingRowComplete(bound);
  const failed =
    mapping.state.kind === "failed" || progress.state.kind === "failed" || !bound.states.ok;
  return (
    <Fragment>
      <tr {...stylex.props(styles.tr)}>
        <th scope="row" {...stylex.props(styles.rowHeader)}>
          <span {...stylex.props(styles.rowHeaderText)}>
            <span {...stylex.props(styles.primaryText)}>{project}</span>
            <Text variant="meta">{bound.connection.name}</Text>
          </span>
        </th>
        <td {...stylex.props(styles.td)}>
          <Select
            aria-label={t("cellLabel", { project, column: t("runnerProject") })}
            options={withCurrent(
              runnerProjects.map((p) => ({ value: p.id, label: p.name })),
              bound.mapping?.runnerProject,
            )}
            value={runnerProject}
            onValueChange={(value) => {
              setRunnerProject(value);
              saveMapping(value, agent);
            }}
            placeholder={ts("mapping.choose")}
          />
        </td>
        <td {...stylex.props(styles.td)}>
          <Select
            aria-label={t("cellLabel", { project, column: t("agent") })}
            options={agents.map((a) => ({ value: a, label: agentName(a) }))}
            value={agent}
            onValueChange={(value) => {
              setAgent(value);
              saveMapping(runnerProject, value);
            }}
            placeholder={ts("mapping.choose")}
          />
        </td>
        <td {...stylex.props(styles.td)}>
          <Select
            aria-label={t("cellLabel", { project, column: t("inProgress") })}
            options={withCurrent(
              bound.states.ok
                ? bound.states.items.map((s) => ({ value: s.id, label: s.name }))
                : [],
              bound.inProgressStateId,
            )}
            value={stateId}
            onValueChange={(value) => {
              setStateId(value);
              progress.run(() => actions.saveInProgress({ ...target, stateId: value }));
            }}
            placeholder={ts("mapping.choose")}
          />
        </td>
        <td {...stylex.props(styles.td, styles.tdLast)}>
          <Tick done={done} label={done ? t("rowDone") : t("rowEmpty")} />
        </td>
      </tr>
      {failed ? (
        <tr>
          <td colSpan={5} {...stylex.props(styles.tdError)}>
            <div {...stylex.props(styles.stackTight)}>
              <SubmitError state={mapping.state} />
              <SubmitError state={progress.state} />
              {bound.states.ok ? null : (
                <p {...stylex.props(styles.error)}>
                  {ts("progress.listFailed", { reason: reason(bound.states.error) })}
                </p>
              )}
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function LabelRow({
  ws,
  label,
  actions,
}: {
  ws: string;
  label: ConnectionLabel;
  actions: SettingsActions;
}) {
  const t = useTranslations("onboarding.mapping");
  const ts = useTranslations("settings");
  const reason = useReason();
  const [labelId, setLabelId] = useState(label.labelId);
  const save = useAutoSave();
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
          <span {...stylex.props(styles.primaryText)}>
            {t("labelTitle")} <Text variant="meta">· {label.connection.name}</Text>
          </span>
          <Text variant="meta">{t("labelHint")}</Text>
        </span>
        <span {...stylex.props(styles.labelSelect)}>
          <Select
            aria-label={t("labelSelect", { connection: label.connection.name })}
            options={allOptions}
            value={labelId}
            onValueChange={(value) => {
              setLabelId(value);
              save.run(() =>
                actions.saveLabel({ ws, connectionId: label.connection.id, labelId: value }),
              );
            }}
            placeholder={ts("label.choose")}
          />
        </span>
        <Tick done={done} label={done ? t("rowDone") : t("rowEmpty")} />
      </div>
      {label.labels.ok ? null : (
        <p {...stylex.props(styles.error)}>
          {ts("label.listFailed", { reason: reason(label.labels.error) })}
        </p>
      )}
      <SubmitError state={save.state} />
    </Card>
  );
}

const styles = stylex.create({
  page: {
    display: "grid",
    gridTemplateColumns: {
      default: "240px minmax(0, 760px)",
      "@media (max-width: 900px)": "minmax(0, 1fr)",
    },
    justifyContent: "center",
    columnGap: space.s10,
    rowGap: space.s6,
    minHeight: "100dvh",
    paddingTop: space.s10,
    paddingInline: space.s6,
    paddingBottom: space.s10,
    boxSizing: "border-box",
    backgroundColor: colors.bgCanvas,
  },
  nav: { display: "flex", flexDirection: "column", gap: space.s6 },
  brand: {
    color: colors.textPrimary,
    fontSize: fontSize.panel,
    fontWeight: fontWeight.semibold,
  },
  steps: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  step: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    width: "100%",
    paddingBlock: space.s2,
    paddingInline: space.s3,
    borderRadius: radius.control,
    color: colors.textTertiary,
    fontSize: fontSize.body,
    boxSizing: "border-box",
  },
  stepButton: {
    borderWidth: 0,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.bgHover },
    },
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
  },
  stepDone: { color: colors.textSecondary },
  stepCurrent: { backgroundColor: colors.bgCard, color: colors.textPrimary },
  marker: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 22,
    height: 22,
    borderRadius: radius.full,
    backgroundColor: colors.bgControl,
    color: colors.textTertiary,
    fontSize: fontSize.label,
    fontVariantNumeric: "tabular-nums",
  },
  markerDone: { backgroundColor: colors.progressSoft, color: colors.progress },
  markerCurrent: { backgroundColor: colors.accent, color: colors.textOnAccent },
  doneCircle: { width: 28, height: 28 },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
    minWidth: 0,
  },
  heading: { display: "flex", flexDirection: "column", gap: space.s2 },
  eyebrow: {
    color: colors.textTertiary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
    fontVariantNumeric: "tabular-nums",
  },
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
    color: colors.textSecondary,
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
  summaryTitle: { color: colors.textPrimary, fontWeight: fontWeight.medium },
  summaryActions: { display: "flex", flexWrap: "wrap", gap: space.s2, flexShrink: 0 },
  inset: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    paddingBlock: space.s4,
    paddingInline: space.s4,
    borderRadius: radius.control,
    backgroundColor: colors.bgInset,
    color: colors.textSecondary,
  },
  insetTitle: { color: colors.textPrimary, fontWeight: fontWeight.medium },
  link: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.px6,
    color: colors.accentText,
    fontWeight: fontWeight.medium,
    textDecoration: { default: "none", ":hover": "underline" },
    textUnderlineOffset: 3,
    borderRadius: radius.control,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  details: {
    paddingBlock: space.s4,
    paddingInline: space.s5,
    borderRadius: radius.card,
    backgroundColor: colors.bgCard,
    color: colors.textSecondary,
    lineHeight: lineHeight.relaxed,
  },
  detailsSummary: {
    cursor: "pointer",
    color: colors.textPrimary,
    fontWeight: fontWeight.medium,
    borderRadius: radius.control,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  detailsBody: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    paddingTop: space.s3,
  },
  compare: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: space.s2,
  },
  compareItem: { fontSize: fontSize.ui, gap: space.s1 },
  para: { margin: 0 },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    padding: space.s5,
    borderRadius: radius.card,
    backgroundColor: colors.bgCard,
  },
  cardHeader: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  cardTitle: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: fontSize.panel,
    fontWeight: fontWeight.semibold,
  },
  numbered: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
  },
  numberedItem: { display: "flex", gap: space.s3, alignItems: "flex-start" },
  numberedMarker: { backgroundColor: colors.accentSoft, color: colors.accentText },
  numberedBody: {
    flexGrow: 1,
    minWidth: 0,
    color: colors.textSecondary,
    lineHeight: lineHeight.relaxed,
  },
  permission: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: space.s2 },
  chip: {
    flexShrink: 0,
    paddingInline: space.px6,
    borderRadius: radius.pill,
    backgroundColor: colors.bgControl,
    color: colors.textSecondary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
  },
  chipStrong: { color: colors.textPrimary },
  checklist: {
    margin: 0,
    paddingBlock: 0,
    paddingInlineStart: space.s10,
    paddingInlineEnd: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    color: colors.textPrimary,
  },
  checkItem: { display: "flex", alignItems: "center", gap: space.s2, flexWrap: "wrap" },
  tick: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 18,
    height: 18,
    color: colors.progress,
  },
  tickEmpty: {
    display: "inline-block",
    flexShrink: 0,
    width: 14,
    height: 14,
    boxSizing: "border-box",
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: colors.borderStrong,
    borderRadius: radius.full,
  },
  fieldset: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    minWidth: 0,
  },
  legend: { color: colors.textSecondary, fontWeight: fontWeight.medium },
  group: {
    display: "flex",
    flexDirection: "column",
    paddingBlock: space.s2,
    paddingInline: space.s1,
    borderRadius: radius.control,
    backgroundColor: colors.bgInset,
  },
  groupTitle: {
    paddingTop: space.s1,
    paddingInline: space.s3,
    color: colors.textTertiary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
  },
  tableBox: {
    position: "relative",
    overflowX: "auto",
    borderRadius: radius.card,
    backgroundColor: colors.bgCard,
  },
  table: {
    width: "100%",
    minWidth: 640,
    borderCollapse: "collapse",
    fontSize: fontSize.body,
  },
  th: {
    paddingTop: space.s4,
    paddingBottom: space.s2,
    paddingInline: space.s2,
    color: colors.textTertiary,
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
    textAlign: "start",
    whiteSpace: "nowrap",
  },
  thFirst: { paddingInlineStart: space.s5 },
  thLast: { width: 18, paddingInlineEnd: space.s5 },
  tr: {
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  rowHeader: {
    paddingBlock: space.s3,
    paddingInlineStart: space.s5,
    paddingInlineEnd: space.s2,
    textAlign: "start",
    fontWeight: fontWeight.regular,
    verticalAlign: "middle",
  },
  rowHeaderText: { display: "flex", flexDirection: "column", gap: space.px2 },
  td: {
    paddingBlock: space.s3,
    paddingInline: space.s2,
    verticalAlign: "middle",
    minWidth: 140,
  },
  tdLast: { minWidth: 0, paddingInlineEnd: space.s5 },
  tdError: { paddingBottom: space.s3, paddingInline: space.s5 },
  labelRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
  labelText: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    flexGrow: 1,
    flexBasis: 280,
    minWidth: 0,
  },
  labelSelect: { flexGrow: 0, flexShrink: 1, flexBasis: 240, minWidth: 0 },
  command: {
    display: "block",
    paddingBlock: space.s2,
    paddingInline: space.s3,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.borderDefault,
    borderRadius: radius.control,
    backgroundColor: colors.bgInset,
    color: colors.textPrimary,
    fontFamily: fonts.mono,
    overflowWrap: "anywhere",
  },
  word: { whiteSpace: "pre" },
  locked: { color: colors.textTertiary, fontSize: fontSize.ui, lineHeight: lineHeight.normal },
  focusTarget: {
    borderRadius: radius.control,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
  primaryText: { color: colors.textPrimary },
  ok: { margin: 0, color: colors.textPrimary },
  error: { margin: 0, color: colors.problem },
});

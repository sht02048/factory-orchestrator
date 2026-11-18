import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  Card,
  Field,
  Input,
  PanelBlock,
  Text,
  buttonStyles,
  showToast,
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
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import {
  ConnectionForm,
  GitHubPanel,
  LabelPanel,
  MappingPanel,
  ProgressPanel,
  ProjectsPanel,
  RunnerCheck,
  RunnerForm,
  WebhookAddressForm,
  useRunnerCheckPolling,
  useRunnerErrorName,
} from "../settings/settings-screen";
import type { ActionResult, SettingsActions } from "../settings/settings-screen";
import type {
  AddressesView,
  RunnerSettingsView,
  SettingsPage,
  TrackerConnectionView,
  WorkspaceSettings,
} from "../settings/model";
import {
  MAPPING_PARTS,
  ONBOARDING_STEPS,
  missingMappingParts,
  reachableIndex,
  runnerPassed,
  runnerProblems,
  serviceInstallCommand,
  serviceInstallTemplate,
  stepPassed,
} from "./model";
import type { OnboardingStep } from "./model";

export interface OnboardingActions extends SettingsActions {
  createWorkspace: (input: { name: string }) => Promise<ActionResult>;
}

export interface OnboardingScreenProps {
  page: SettingsPage;
  index: number;
  onStep: (index: number) => void;
  onFinish: () => void;
  actions: OnboardingActions;
}

export function OnboardingScreen({
  page,
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
          <StepBody step={step} page={page} actions={actions} workerSilent={workerSilent} />
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

function StepBody({
  step,
  page,
  actions,
  workerSilent,
}: {
  step: OnboardingStep;
  page: SettingsPage;
  actions: OnboardingActions;
  workerSilent: boolean;
}) {
  switch (step) {
    case "tracker":
      return (
        <TrackerStep
          connections={page.install.connections}
          addresses={page.install.addresses}
          actions={actions}
        />
      );
    case "github":
      return (
        <Card>
          <GitHubPanel saved={page.install.githubToken} actions={actions} />
        </Card>
      );
    case "runner":
      return (
        <RunnerStep runners={page.install.runners} actions={actions} workerSilent={workerSilent} />
      );
    case "workspace":
      return <WorkspaceStep page={page} actions={actions} />;
    case "mapping":
      return page.workspace === null ? null : (
        <MappingStep workspace={page.workspace} page={page} actions={actions} />
      );
  }
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
  const missing = missingMappingParts(workspace);
  return (
    <>
      {MAPPING_PARTS.map((part) => (
        <Card key={part} label={t(`parts.${part}`)}>
          <Text variant="title">{t(`parts.${part}`)}</Text>
          {part === "mapping" ? (
            <MappingPanel workspace={workspace} page={page} actions={actions} />
          ) : part === "progress" ? (
            <ProgressPanel workspace={workspace} actions={actions} />
          ) : (
            <LabelPanel workspace={workspace} actions={actions} />
          )}
        </Card>
      ))}
      <div role="status" {...stylex.props(styles.stack)}>
        {missing.length === 0 ? (
          <p {...stylex.props(styles.ok)}>{t("ready")}</p>
        ) : (
          <>
            <Text variant="body">{t("missingTitle")}</Text>
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

function TrackerStep({
  connections,
  addresses,
  actions,
}: {
  connections: TrackerConnectionView[];
  addresses: AddressesView;
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
              <ConnectionForm connection={null} actions={actions} />
            </Card>
          </li>
        ) : (
          connections.map((connection) => (
            <li key={connection.id}>
              <Card>
                <ConnectionForm connection={connection} actions={actions} />
                <WebhookGuide
                  connection={connection}
                  webhookAddress={addresses.webhookAddress}
                  titleRef={connection.id === newest ? added : undefined}
                />
              </Card>
            </li>
          ))
        )}
      </ul>
      {connections.length === 0 ? null : (
        <Card>
          <WebhookAddressForm addresses={addresses} actions={actions} />
        </Card>
      )}
    </>
  );
}

function WebhookGuide({
  connection,
  webhookAddress,
  titleRef,
}: {
  connection: TrackerConnectionView;
  webhookAddress: string | null;
  titleRef?: Ref<HTMLSpanElement> | undefined;
}) {
  const t = useTranslations("onboarding.webhook");
  return (
    <PanelBlock
      title={
        titleRef === undefined ? t("title") : <FocusTarget ref={titleRef}>{t("title")}</FocusTarget>
      }
    >
      <div {...stylex.props(styles.stack)}>
        <Text variant="body">{t("intro")}</Text>
        <ol {...stylex.props(styles.bullets)}>
          <li>{t("stepOpen")}</li>
          <li>{t("stepUrl")}</li>
          <li>{t("stepEvents")}</li>
          <li>{t("stepSecret")}</li>
        </ol>
        {webhookAddress === null ? (
          <>
            <div role="status" {...stylex.props(styles.stack)}>
              <p {...stylex.props(styles.ok)}>{t("addressMissingTitle")}</p>
              <Text variant="body">{t("addressMissingBody")}</Text>
            </div>
            <Field label={t("path")}>
              <Input value={connection.webhookPath} readOnly mono />
            </Field>
          </>
        ) : (
          <Field label={t("url")} description={t("urlDescription")}>
            <Input value={`${webhookAddress}${connection.webhookPath}`} readOnly mono />
          </Field>
        )}
        <div role="status" {...stylex.props(styles.stack)}>
          {connection.hasWebhookSecret ? (
            <p {...stylex.props(styles.ok)}>{t("secretSaved")}</p>
          ) : (
            <>
              <p {...stylex.props(styles.ok)}>{t("secretMissingTitle")}</p>
              <Text variant="body">{t("secretMissingBody")}</Text>
            </>
          )}
        </div>
      </div>
    </PanelBlock>
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
  const t = useTranslations("onboarding.runner");
  const added = useFocusWhenAdded(runners.length);
  const newest = runners.at(-1)?.id;
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
            <Card>
              <RunnerForm runner={runner} actions={actions} />
            </Card>
            <Card>
              <PanelBlock
                title={
                  <FocusTarget ref={runner.id === newest ? added : null}>
                    {t("checkTitle", { name: runner.name })}
                  </FocusTarget>
                }
              >
                <div {...stylex.props(styles.stack)}>
                  <RunnerCheck runner={runner} actions={actions} workerSilent={workerSilent} />
                  <RunnerGuide runner={runner} />
                </div>
              </PanelBlock>
            </Card>
          </li>
        ))
      )}
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
  if (runnerPassed(runner)) {
    return (
      <p role="status" {...stylex.props(styles.ok)}>
        {t("passed")}
      </p>
    );
  }
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

function WorkspaceStep({ page, actions }: { page: SettingsPage; actions: OnboardingActions }) {
  const t = useTranslations("onboarding.workspace");
  const workspace = page.workspace;
  const added = useFocusWhenAdded(workspace === null ? 0 : 1);
  return (
    <Card>
      {workspace === null ? (
        <CreateWorkspaceForm actions={actions} />
      ) : (
        <>
          <div {...stylex.props(styles.stack)}>
            <Text variant="title">
              <FocusTarget ref={added}>
                {t("current", { name: workspace.general.name })}
              </FocusTarget>
            </Text>
            <Text variant="meta">{t("pickHint")}</Text>
          </div>
          <ProjectsPanel workspace={workspace} actions={actions} />
        </>
      )}
    </Card>
  );
}

function CreateWorkspaceForm({ actions }: { actions: OnboardingActions }) {
  const t = useTranslations("onboarding.workspace");
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "failed">("idle");
  const ready = name.trim() !== "";
  return (
    <form
      {...stylex.props(styles.stack)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || state === "sending") return;
        setState("sending");
        actions.createWorkspace({ name: name.trim() }).then(
          (result) => {
            setState(result.ok ? "idle" : "failed");
            if (result.ok) showToast(t("created"));
          },
          () => setState("failed"),
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
      {state === "failed" ? (
        <p role="alert" {...stylex.props(styles.error)}>
          {t("failed")}
        </p>
      ) : null}
      <Actions>
        <Button variant="primary" type="submit" disabled={!ready || state === "sending"}>
          {state === "sending" ? t("creating") : t("create")}
        </Button>
      </Actions>
    </form>
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
  stack: { display: "flex", flexDirection: "column", gap: space.s3, margin: 0 },
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
  ok: { margin: 0, color: colors.textPrimary },
  error: { margin: 0, color: colors.problem },
});

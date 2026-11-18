import * as stylex from "@stylexjs/stylex";
import { Actions, Button, Card, Field, Input, PanelBlock, Text } from "@factory/ui";
import { colors, fontSize, fontWeight, fonts, radius, space } from "@factory/ui/tokens.stylex";
import type { ReactNode } from "react";
import { useState } from "react";
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

/** 온보딩의 행동. 입력 폼은 Settings 의 행동을 그대로 쓰고, 첫 Workspace 만들기만 더한다 */
export interface OnboardingActions extends SettingsActions {
  createWorkspace: (input: { name: string }) => Promise<ActionResult>;
}

export interface OnboardingScreenProps {
  page: SettingsPage;
  /** 보일 단계(0부터). 라우트가 resolveStep 으로 정한다 */
  index: number;
  onStep: (index: number) => void;
  /** 마지막 단계를 마쳤을 때. 홈으로 간다 */
  onFinish: () => void;
  actions: OnboardingActions;
}

/**
 * 온보딩: 사이드바 없는 전체 화면(ADR 0007). 왼쪽 단계 목록, 가운데 입력과 확인 결과(ADR 0010, 시안 B).
 * 입력 폼과 연결 확인은 Settings 의 것을 그대로 쓴다. 단계의 확인이 성공해야 다음으로 간다.
 * 파란 주 버튼은 하나다: 확인이 성공하면 "다음", 그 전에는 단계의 저장 버튼이다(ADR 0010 6번).
 */
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
          <Text variant="page">{t(`steps.${step}.title`)}</Text>
          <Text variant="body">{t(`steps.${step}.description`)}</Text>
        </div>
        {/* 단계를 바꾸면 편집 중인 값을 새로 채운다 */}
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
            {passed ? null : <Text variant="meta">{t("nextLocked")}</Text>}
            <Button
              variant={passed ? "primary" : "secondary"}
              disabled={!passed}
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

/**
 * 왼쪽 단계 목록. 확인이 성공한 단계는 체크, 지금 단계는 번호를 밝게 보인다.
 * 앞 단계가 모두 성공한 단계까지만 누를 수 있다(resolveStep 과 같은 규칙).
 */
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
                {done && !current ? <CheckMark /> : i + 1}
              </span>
              <span>{t(`steps.${step}.name`)}</span>
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

// ---------- 첫 Mapping ----------

/**
 * Mapping 단계(0042). Mapping 과 함께 "In Progress" 상태와 Auto-assign Label 을 정한다. 셋 다 필수다
 * (스펙 3절 1번). 입력 폼과 저장은 Settings 의 것을 그대로 쓴다.
 */
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
      {missing.length === 0 ? (
        <p role="status" {...stylex.props(styles.ok)}>
          {t("ready")}
        </p>
      ) : (
        <div role="status" {...stylex.props(styles.stack)}>
          <Text variant="body">{t("missingTitle")}</Text>
          <ul {...stylex.props(styles.bullets)}>
            {missing.map((part) => (
              <li key={part}>{t(`missing.${part}`)}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// ---------- 트래커 연결 ----------

function TrackerStep({
  connections,
  addresses,
  actions,
}: {
  connections: TrackerConnectionView[];
  addresses: AddressesView;
  actions: SettingsActions;
}) {
  if (connections.length === 0) {
    return (
      <Card>
        <ConnectionForm connection={null} actions={actions} />
      </Card>
    );
  }
  return (
    <>
      <ul {...stylex.props(styles.list)}>
        {connections.map((connection) => (
          <li key={connection.id}>
            <Card>
              <ConnectionForm connection={connection} actions={actions} />
              <WebhookGuide connection={connection} webhookAddress={addresses.webhookAddress} />
            </Card>
          </li>
        ))}
      </ul>
      <Card>
        <WebhookAddressForm addresses={addresses} actions={actions} />
      </Card>
    </>
  );
}

/**
 * Linear webhook 을 운영자가 만드는 방법(research 0002 B.2). webhook 주소는 설정한 webhook 공개 주소로 그린다
 * (0048). 브라우저 주소창의 주소는 tailnet·127.0.0.1 이라 트래커가 닿지 못한다. 공개 주소가 없으면 경로와
 * 정하는 방법을 보인다.
 */
function WebhookGuide({
  connection,
  webhookAddress,
}: {
  connection: TrackerConnectionView;
  webhookAddress: string | null;
}) {
  const t = useTranslations("onboarding.webhook");
  return (
    <PanelBlock title={t("title")}>
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
        {/* 다음으로 가는 것은 막지 않는다. webhook 없이도 폴링 보정으로 할당한다(ADR 0001). 실패가 아니니 실패 색을 쓰지 않는다 */}
        {connection.hasWebhookSecret ? (
          <p role="status" {...stylex.props(styles.ok)}>
            {t("secretSaved")}
          </p>
        ) : (
          <div role="status" {...stylex.props(styles.stack)}>
            <p {...stylex.props(styles.ok)}>{t("secretMissingTitle")}</p>
            <Text variant="body">{t("secretMissingBody")}</Text>
          </div>
        )}
      </div>
    </PanelBlock>
  );
}

// ---------- 러너 ----------

function RunnerStep({
  runners,
  actions,
  workerSilent,
}: {
  runners: RunnerSettingsView[];
  actions: SettingsActions;
  workerSilent: boolean;
}) {
  if (runners.length === 0) {
    return (
      <>
        <Card>
          <RunnerBefore />
        </Card>
        <Card>
          <RunnerForm runner={null} actions={actions} />
        </Card>
      </>
    );
  }
  return (
    <ul {...stylex.props(styles.list)}>
      {runners.map((runner) => (
        <li key={runner.id} {...stylex.props(styles.item)}>
          <Card>
            <RunnerForm runner={runner} actions={actions} />
          </Card>
          <Card>
            <RunnerCheck runner={runner} actions={actions} workerSilent={workerSilent} />
            <RunnerGuide runner={runner} />
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** 러너를 등록하기 전에 러너에서 해 둘 일(스펙 9절의 러너 필수 조건, Q43) */
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

/** 러너 확인 결과에 따라 다음 할 일을 안내한다. 필수 조건별 상태는 RunnerCheck 가 보인다 */
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
  // Orca 상시 서비스가 없으면 러너 런타임이 준비되지 않아 Offline 으로도 온다. 아는 원인을 먼저 안내한다
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

/**
 * 러너에서 그대로 붙여 넣을 명령. 길어도 잘리지 않게 줄을 바꾸되, `--command` 의 하이픈 뒤처럼
 * 낱말 가운데서는 바꾸지 않고 낱말 사이에서만 바꾼다.
 */
function Command({ value }: { value: string }) {
  const words = value.split(" ");
  return (
    <code {...stylex.props(styles.command)}>
      {words.map((word, i) => (
        // 같은 낱말이 되풀이될 수 있어 자리로 가린다. 명령은 바뀌지 않는다
        <span key={i} {...stylex.props(styles.word)}>
          {i === 0 ? word : ` ${word}`}
        </span>
      ))}
    </code>
  );
}

// ---------- 첫 Workspace ----------

function WorkspaceStep({ page, actions }: { page: SettingsPage; actions: OnboardingActions }) {
  const t = useTranslations("onboarding.workspace");
  const workspace = page.workspace;
  if (workspace === null) {
    return (
      <Card>
        <CreateWorkspaceForm actions={actions} />
      </Card>
    );
  }
  return (
    <Card>
      <div {...stylex.props(styles.stack)}>
        <Text variant="title">{t("current", { name: workspace.general.name })}</Text>
        <Text variant="meta">{t("pickHint")}</Text>
      </div>
      <ProjectsPanel workspace={workspace} actions={actions} />
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
          (result) => setState(result.ok ? "idle" : "failed"),
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
    backgroundColor: { default: "transparent", ":hover": colors.bgHover },
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.accentText}` },
  },
  stepDone: { color: colors.textSecondary },
  stepCurrent: {
    backgroundColor: colors.bgCard,
    color: colors.textPrimary,
    fontWeight: fontWeight.semibold,
  },
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
  ok: { margin: 0, color: colors.textPrimary },
  error: { margin: 0, color: colors.problem },
});

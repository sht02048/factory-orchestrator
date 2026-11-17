import * as stylex from "@stylexjs/stylex";
import { Actions, Button, Field, Input, PanelBlock, Text } from "@factory/ui";
import { colors, fonts, radius, space } from "@factory/ui/tokens.stylex";
import { useEffect, useState } from "react";
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
  useRunnerCheckPolling,
  useRunnerErrorName,
} from "../settings/settings-screen";
import type { ActionResult, SettingsActions } from "../settings/settings-screen";
import type {
  RunnerSettingsView,
  SettingsPage,
  TrackerConnectionView,
  WorkspaceSettings,
} from "../settings/model";
import {
  MAPPING_PARTS,
  ONBOARDING_STEPS,
  missingMappingParts,
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
 * 온보딩: 사이드바 없는 전체 화면, 가운데 한 열에 한 단계씩(ADR 0007, 시안 B onboarding.html).
 * 입력 폼과 연결 확인은 Settings 의 것을 그대로 쓴다. 단계의 확인이 성공해야 다음으로 간다.
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
      <div {...stylex.props(styles.top)}>
        {index > 0 ? (
          <Button variant="ghost" onClick={() => onStep(index - 1)}>
            {t("back")}
          </Button>
        ) : null}
      </div>
      <main {...stylex.props(styles.column)}>
        <Progress index={index} />
        <div {...stylex.props(styles.heading)}>
          <Text variant="page">{t(`steps.${step}.title`)}</Text>
          <Text variant="body">{t(`steps.${step}.description`)}</Text>
        </div>
        {/* 단계를 바꾸면 편집 중인 값을 새로 채운다 */}
        <div key={step} {...stylex.props(styles.body)}>
          <StepBody step={step} page={page} actions={actions} workerSilent={workerSilent} />
        </div>
        <div {...stylex.props(styles.footer)}>
          {passed ? null : <Text variant="meta">{t("nextLocked")}</Text>}
          <Button
            variant={passed ? "primary" : "default"}
            disabled={!passed}
            onClick={() => (last ? onFinish() : onStep(index + 1))}
          >
            {last ? t("finish") : t("next")}
          </Button>
        </div>
      </main>
    </div>
  );
}

function Progress({ index }: { index: number }) {
  const t = useTranslations("onboarding");
  const total = ONBOARDING_STEPS.length;
  return (
    <div
      role="img"
      aria-label={t("progress", { step: index + 1, total })}
      {...stylex.props(styles.progress)}
    >
      {ONBOARDING_STEPS.map((step, i) => (
        <span
          key={step}
          {...stylex.props(
            styles.dot,
            i < index && styles.dotDone,
            i === index && styles.dotCurrent,
          )}
        />
      ))}
      <span aria-hidden="true" {...stylex.props(styles.count)}>
        {index + 1} / {total}
      </span>
    </div>
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
      return <TrackerStep connections={page.install.connections} actions={actions} />;
    case "github":
      return <GitHubPanel saved={page.install.githubToken} actions={actions} />;
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
        <section key={part} {...stylex.props(styles.section)}>
          <Text variant="title">{t(`parts.${part}`)}</Text>
          {part === "mapping" ? (
            <MappingPanel workspace={workspace} page={page} actions={actions} />
          ) : part === "progress" ? (
            <ProgressPanel workspace={workspace} actions={actions} />
          ) : (
            <LabelPanel workspace={workspace} actions={actions} />
          )}
        </section>
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
  actions,
}: {
  connections: TrackerConnectionView[];
  actions: SettingsActions;
}) {
  if (connections.length === 0) return <ConnectionForm connection={null} actions={actions} />;
  return (
    <ul {...stylex.props(styles.list)}>
      {connections.map((connection) => (
        <li key={connection.id} {...stylex.props(styles.item)}>
          <ConnectionForm connection={connection} actions={actions} />
          <WebhookGuide connection={connection} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Linear webhook 을 운영자가 만드는 방법(research 0002 B.2). 밖에서 닿는 공개 주소는 운영자가 고른 방법에
 * 달려 있어(ADR 0005) 지금 접속한 주소를 예로 보인다. 주소는 브라우저에서만 알 수 있어 그린 뒤에 채운다.
 */
function WebhookGuide({ connection }: { connection: TrackerConnectionView }) {
  const t = useTranslations("onboarding.webhook");
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
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
        <Field label={t("url")} description={t("urlDescription")}>
          <Input value={`${origin}${connection.webhookPath}`} readOnly mono />
        </Field>
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
        <RunnerBefore />
        <RunnerForm runner={null} actions={actions} />
      </>
    );
  }
  return (
    <ul {...stylex.props(styles.list)}>
      {runners.map((runner) => (
        <li key={runner.id} {...stylex.props(styles.item)}>
          <RunnerCheck runner={runner} actions={actions} workerSilent={workerSilent} />
          <RunnerGuide runner={runner} />
          <RunnerForm runner={runner} actions={actions} />
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
  if (workspace === null) return <CreateWorkspaceForm actions={actions} />;
  return (
    <>
      <div {...stylex.props(styles.stack)}>
        <Text variant="title">{t("current", { name: workspace.general.name })}</Text>
        <Text variant="meta">{t("pickHint")}</Text>
      </div>
      <ProjectsPanel workspace={workspace} actions={actions} />
    </>
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
    minHeight: "100dvh",
    backgroundColor: colors.bgCanvas,
  },
  top: {
    display: "flex",
    alignItems: "center",
    height: 56,
    paddingInline: space.s6,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: space.s8,
    width: "100%",
    maxWidth: 560,
    marginInline: "auto",
    paddingTop: "8vh",
    paddingInline: space.s4,
    paddingBottom: space.s10,
    boxSizing: "border-box",
  },
  progress: { display: "flex", alignItems: "center", gap: space.px6 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.borderDefault,
  },
  dotDone: { backgroundColor: colors.textTertiary },
  dotCurrent: { width: 18, backgroundColor: colors.textPrimary },
  count: {
    marginInlineStart: space.s2,
    color: colors.textTertiary,
    fontVariantNumeric: "tabular-nums",
  },
  heading: { display: "flex", flexDirection: "column", gap: space.s2 },
  body: { display: "flex", flexDirection: "column", gap: space.s6 },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: space.s3,
    paddingTop: space.s6,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  stack: { display: "flex", flexDirection: "column", gap: space.s3, margin: 0 },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    paddingTop: { default: space.s6, ":first-child": 0 },
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  list: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
    paddingBlock: space.s6,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
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
    borderRadius: radius.md,
    backgroundColor: colors.bgInset,
    color: colors.textPrimary,
    fontFamily: fonts.mono,
    overflowWrap: "anywhere",
  },
  word: { whiteSpace: "pre" },
  ok: { margin: 0, color: colors.textPrimary },
  error: { margin: 0, color: colors.failed },
});

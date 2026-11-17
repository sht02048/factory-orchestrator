import * as stylex from "@stylexjs/stylex";
import { Actions, Button, Field, Input, PanelBlock, Text } from "@factory/ui";
import { colors, radius, space } from "@factory/ui/tokens.stylex";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import {
  ConnectionForm,
  GitHubPanel,
  MappingPanel,
  ProjectsPanel,
  RunnerCheck,
  RunnerForm,
  useRunnerCheckPolling,
} from "../settings/settings-screen";
import type { ActionResult, SettingsActions } from "../settings/settings-screen";
import type { RunnerSettingsView, SettingsPage, TrackerConnectionView } from "../settings/model";
import {
  ONBOARDING_STEPS,
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
        <MappingPanel workspace={page.workspace} page={page} actions={actions} />
      );
  }
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
  if (!check.online) {
    return (
      <p role="alert" {...stylex.props(styles.error)}>
        {t("offline")}
      </p>
    );
  }
  const problems = runnerProblems(runner);
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
      {problems.service || problems.githubAuth ? null : (
        <div {...stylex.props(styles.stack)}>
          <p {...stylex.props(styles.error)}>{t("otherTitle")}</p>
          <Text variant="body">{t("otherBody")}</Text>
        </div>
      )}
    </div>
  );
}

/** 러너에서 그대로 붙여 넣을 명령. 복사만 하는 값이라 읽기 전용 입력칸에 둔다(DESIGN.md Field) */
function Command({ value }: { value: string }) {
  return (
    <span {...stylex.props(styles.command)}>
      <Input value={value} readOnly mono />
    </span>
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
  command: { display: "block" },
  ok: { margin: 0, color: colors.textPrimary },
  error: { margin: 0, color: colors.failed },
});

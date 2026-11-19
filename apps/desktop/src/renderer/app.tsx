import * as stylex from "@stylexjs/stylex";
import {
  Card,
  Checklist,
  ChecklistItem,
  Field,
  Input,
  Mascot,
  StatusPill,
  Text,
  Tooltip,
  VisuallyHidden,
  buttonStyles,
  textStyles,
} from "@ganger/ui";
import type { ButtonVariant } from "@ganger/ui";
import {
  colors,
  fonts,
  fontSize,
  fontWeight,
  lineHeight,
  motion,
  radius,
  space,
} from "@ganger/ui/tokens.stylex";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { IntlProvider, useTranslations } from "use-intl";
import screens from "../../messages/ko/screens.json" with { type: "json" };
import { ENROLL_STEPS } from "../shared/enrollment";
import type { EnrollStep, EnrollmentPhase, SetupProgress } from "../shared/enrollment";
import type { DesktopApi, FindResult, FoundServerView, ViewState } from "../shared/view";
import {
  AlertIcon,
  ChevronLeftIcon,
  LaptopIcon,
  PauseIcon,
  RefreshIcon,
  ServerIcon,
} from "./icons";

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

const messages = { screens };

export function App() {
  const [view, setView] = useState<ViewState | null>(null);
  useEffect(() => {
    const api = window.desktop;
    if (api === undefined) return;
    const off = api.onView(setView);
    void api.getView().then(setView);
    return off;
  }, []);
  return (
    <IntlProvider locale="ko" messages={messages}>
      <div {...stylex.props(styles.canvas)}>
        {view === null ? null : <Screen key={screenKey(view)} view={view} />}
      </div>
    </IntlProvider>
  );
}

export function screenKey(view: ViewState): string {
  return view.screen === "runner-enrollment"
    ? `${view.screen}:${view.enrollment.phase}`
    : view.screen;
}

function api(): DesktopApi {
  const desktop = window.desktop;
  if (desktop === undefined) throw new Error("desktop api is not available");
  return desktop;
}

export function Screen({ view }: { view: ViewState }) {
  switch (view.screen) {
    case "choose-mode":
      return <ChooseMode />;
    case "local-starting":
    case "local-stopped":
    case "local-failed":
    case "local-service":
      return <LocalState view={view} />;
    case "find-servers":
      return <FindServers port={view.port} searching={view.searching} result={view.result} />;
    case "enter-address":
      return <EnterAddress checking={view.checking} error={view.error} />;
    case "unreachable":
      return <Unreachable name={view.name} url={view.url} checking={view.checking} />;
    case "runner-enrollment":
      return <RunnerEnrollment server={view.server} enrollment={view.enrollment} />;
  }
}

type FrameWidth = "wide" | "form" | "status";

function Frame({
  width,
  centered = false,
  children,
}: {
  width: FrameWidth;
  centered?: boolean;
  children: ReactNode;
}) {
  return (
    <main {...stylex.props(styles.frame, centered && styles.frameCentered)}>
      <div
        {...stylex.props(
          styles.column,
          frameWidths[width],
          width === "status" && styles.statusColumn,
        )}
      >
        {children}
      </div>
    </main>
  );
}

function Header({
  title,
  summary,
  centered = false,
  live = false,
}: {
  title: ReactNode;
  summary: ReactNode;
  centered?: boolean;
  live?: boolean;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  return (
    <header {...stylex.props(styles.header, centered && styles.centerText)}>
      <h1 ref={titleRef} tabIndex={-1} {...stylex.props(...textStyles("page"), styles.title)}>
        {title}
      </h1>
      <p role={live ? "status" : undefined} {...stylex.props(styles.summary)}>
        {summary}
      </p>
    </header>
  );
}

function ActionButton({
  variant = "secondary",
  size = "large",
  wide = false,
  disabled = false,
  type = "button",
  describedBy,
  onClick,
  children,
}: {
  variant?: ButtonVariant;
  size?: "large" | "medium";
  wide?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  describedBy?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      data-variant={variant}
      onClick={() => {
        if (!disabled) onClick?.();
      }}
      {...stylex.props(
        ...buttonStyles(variant, disabled),
        size === "large" ? styles.buttonLarge : styles.buttonMedium,
        wide && styles.buttonWide,
      )}
    >
      {children}
    </button>
  );
}

function TextLink({
  onClick,
  expanded,
  controls,
  children,
}: {
  onClick: () => void;
  expanded?: boolean;
  controls?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
      {...stylex.props(styles.textButton, styles.textLink)}
    >
      {children}
    </button>
  );
}

function BackLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} {...stylex.props(styles.textButton, styles.backLink)}>
      <ChevronLeftIcon />
      {children}
    </button>
  );
}

function Spinner() {
  return <span aria-hidden="true" {...stylex.props(styles.spinner)} />;
}

function StatusIcon({ tone, children }: { tone: "problem" | "neutral"; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      {...stylex.props(
        styles.statusIcon,
        tone === "problem" ? styles.statusIconProblem : styles.statusIconNeutral,
      )}
    >
      {children}
    </span>
  );
}

function CenteredActions({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.actions, styles.actionsCentered)}>{children}</div>;
}

function ChooseMode() {
  const t = useTranslations("screens.chooseMode");
  const [openAtLogin, setOpenAtLogin] = useState(true);
  return (
    <Frame width="wide" centered>
      <Header title={t("title")} summary={t("summary")} centered />
      <div {...stylex.props(styles.modes)}>
        <Card>
          <span {...stylex.props(styles.modeIcon)}>
            <LaptopIcon />
          </span>
          <Text variant="panel">{t("local.title")}</Text>
          <Text variant="body">{t("local.body")}</Text>
          <label {...stylex.props(styles.modeFooter, styles.check)}>
            <input
              type="checkbox"
              checked={openAtLogin}
              onChange={(event) => setOpenAtLogin(event.currentTarget.checked)}
              {...stylex.props(styles.checkbox)}
            />
            {t("local.openAtLogin")}
          </label>
          <ActionButton
            variant="primary"
            wide
            onClick={() => void api().chooseLocal({ openAtLogin })}
          >
            {t("local.action")}
          </ActionButton>
        </Card>
        <Card>
          <span {...stylex.props(styles.modeIcon)}>
            <ServerIcon />
          </span>
          <Text variant="panel">{t("remote.title")}</Text>
          <Text variant="body">{t("remote.body")}</Text>
          <p {...stylex.props(styles.modeFooter, styles.modeNote)}>{t("remote.note")}</p>
          <ActionButton wide onClick={() => void api().chooseRemote()}>
            {t("remote.action")}
          </ActionButton>
        </Card>
      </div>
    </Frame>
  );
}

function LocalState({
  view,
}: {
  view: Extract<
    ViewState,
    { screen: "local-starting" | "local-stopped" | "local-failed" | "local-service" }
  >;
}) {
  const t = useTranslations("screens.local");
  const otherMode = (
    <ActionButton variant="ghost" onClick={() => void api().chooseMode()}>
      {t("otherMode")}
    </ActionButton>
  );
  switch (view.screen) {
    case "local-starting":
      return (
        <Frame width="status" centered>
          <div role="status" {...stylex.props(styles.statusBlock)}>
            <Mascot mood="signal" />
            <Header title={t("startingTitle")} summary={t("startingSummary")} centered />
          </div>
        </Frame>
      );
    case "local-stopped":
      return (
        <Frame width="status" centered>
          <StatusIcon tone="neutral">
            <PauseIcon />
          </StatusIcon>
          <Header title={t("stoppedTitle")} summary={t("stoppedSummary")} centered />
          <CenteredActions>
            <ActionButton variant="primary" onClick={() => void api().startLocal()}>
              {t("start")}
            </ActionButton>
            {otherMode}
          </CenteredActions>
        </Frame>
      );
    case "local-failed":
      return (
        <Frame width="status" centered>
          <StatusIcon tone="problem">
            <AlertIcon size={26} />
          </StatusIcon>
          <Header title={t("failedTitle")} summary={t("failedSummary")} centered />
          <section aria-label={t("logLabel")} {...stylex.props(styles.infoBox, styles.logBox)}>
            <span {...stylex.props(styles.logPath)}>{view.logFile}</span>
            <ActionButton size="medium" onClick={() => void api().openLog()}>
              {t("openLog")}
            </ActionButton>
          </section>
          <CenteredActions>
            <ActionButton variant="primary" onClick={() => void api().retry()}>
              {t("retry")}
            </ActionButton>
            {otherMode}
          </CenteredActions>
        </Frame>
      );
    case "local-service":
      return (
        <Frame width="status" centered>
          <StatusIcon tone="neutral">
            <ServerIcon size={26} />
          </StatusIcon>
          <Header title={t("serviceTitle")} summary={t("serviceSummary")} centered />
          <CenteredActions>{otherMode}</CenteredActions>
        </Frame>
      );
  }
}

function FindServers({
  port,
  searching,
  result,
}: {
  port: number;
  searching: boolean;
  result: FindResult | null;
}) {
  const t = useTranslations("screens.find");
  const [portText, setPortText] = useState(String(port));
  const [portOpen, setPortOpen] = useState(false);
  const portFormId = useId();
  const portInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (portOpen) portInput.current?.focus();
  }, [portOpen]);
  const servers = result?.kind === "found" ? result.servers : [];
  const openable = servers.filter((server) => server.webAccess === "allowed").length;
  const summary =
    searching || result === null
      ? t("searching")
      : result.kind === "found"
        ? servers.length > 0
          ? t("found", { count: servers.length })
          : t("noneFound")
        : t(result.kind);
  const nextPort = Number(portText);
  const portValid = Number.isInteger(nextPort) && nextPort > 0 && nextPort < 65_536;
  return (
    <Frame width="form">
      <BackLink onClick={() => void api().chooseMode()}>{t("back")}</BackLink>
      <Header title={t("title")} summary={summary} live />
      <Card padding="compact">
        <div {...stylex.props(styles.listHeader)}>
          <Text variant="label" as="h2">
            {t("listLabel")}
          </Text>
          <Tooltip
            content={t("refresh")}
            labelsTrigger
            action={{
              variant: "ghost",
              busy: searching,
              onClick: () => void api().findServers(port),
            }}
          >
            <RefreshIcon />
          </Tooltip>
        </div>
        {servers.length > 0 ? (
          <ul {...stylex.props(styles.list)}>
            {servers.map((server) => (
              <ServerRow
                key={server.instanceId}
                server={server}
                primary={openable === 1 && server.webAccess === "allowed"}
              />
            ))}
          </ul>
        ) : (
          <div {...stylex.props(styles.listEmpty)}>
            {searching ? <Spinner /> : <Text variant="meta">{t("empty")}</Text>}
          </div>
        )}
      </Card>
      <div {...stylex.props(styles.moreLine)}>
        <Text variant="meta">{t("notListed")}</Text>
        <TextLink onClick={() => void api().showAddress()}>{t("byAddress")}</TextLink>
        <span aria-hidden="true" {...stylex.props(styles.separator)}>
          ·
        </span>
        <TextLink
          expanded={portOpen}
          controls={portFormId}
          onClick={() => setPortOpen((open) => !open)}
        >
          {t("otherPort")}
        </TextLink>
      </div>
      <form
        id={portFormId}
        hidden={!portOpen}
        {...stylex.props(styles.portForm)}
        onSubmit={(event) => {
          event.preventDefault();
          if (!searching && portValid) void api().findServers(nextPort);
        }}
      >
        <Field label={t("port")} description={t("portDescription")}>
          <div {...stylex.props(styles.portRow)}>
            <div {...stylex.props(styles.portInput)}>
              <Input
                ref={portInput}
                value={portText}
                onValueChange={setPortText}
                inputMode="numeric"
                autoComplete="off"
                mono
              />
            </div>
            <ActionButton type="submit" size="medium" disabled={searching || !portValid}>
              {t("searchPort")}
            </ActionButton>
          </div>
        </Field>
      </form>
    </Frame>
  );
}

function ServerRow({ server, primary }: { server: FoundServerView; primary: boolean }) {
  const t = useTranslations("screens.find");
  const nameId = useId();
  const openable = server.webAccess === "allowed";
  return (
    <li {...stylex.props(styles.row)}>
      <div {...stylex.props(styles.rowMain)}>
        <span aria-hidden="true" {...stylex.props(styles.rowIcon)}>
          <ServerIcon size={20} />
        </span>
        <div {...stylex.props(styles.rowText)}>
          <div id={nameId}>
            <Text variant="title" truncate>
              {server.name}
            </Text>
          </div>
          <span {...stylex.props(styles.meta)}>
            <StatusPill status="online">{t("online")}</StatusPill>
            <Text variant="meta" numeric>
              {t("version", { version: server.version })}
            </Text>
            {server.versionDiffers ? <Text variant="meta">{t("versionDiffers")}</Text> : null}
          </span>
        </div>
        {openable ? (
          <ActionButton
            size="medium"
            variant={primary ? "primary" : "secondary"}
            describedBy={nameId}
            onClick={() => void api().connectFound(server.instanceId)}
          >
            {t("open")}
          </ActionButton>
        ) : (
          <ActionButton size="medium" describedBy={nameId} onClick={() => void api().showAddress()}>
            {t("openByAddress")}
          </ActionButton>
        )}
      </div>
      {openable ? null : (
        <p {...stylex.props(styles.rowNote)}>
          <AlertIcon size={15} />
          {t("hostNotAllowed")}
        </p>
      )}
    </li>
  );
}

function EnterAddress({ checking, error }: { checking: boolean; error: string | null }) {
  const t = useTranslations("screens.address");
  const [address, setAddress] = useState("");
  const addressInput = useRef<HTMLInputElement>(null);
  const errorText =
    error === "invalid" ||
    error === "unreachable" ||
    error === "not-ours" ||
    error === "host-not-allowed"
      ? t(`errors.${error}`)
      : undefined;
  return (
    <Frame width="form">
      <BackLink onClick={() => void api().chooseRemote()}>{t("back")}</BackLink>
      <Header title={t("title")} summary={t("summary")} />
      <form
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          if (checking) return;
          if (address.trim() === "") addressInput.current?.focus();
          else void api().connectAddress(address);
        }}
      >
        <Card>
          <Field
            label={t("label")}
            description={t("hint")}
            error={
              errorText === undefined ? undefined : (
                <span {...stylex.props(styles.errorLine)}>
                  <span {...stylex.props(styles.errorIcon)}>
                    <AlertIcon />
                  </span>
                  {errorText}
                </span>
              )
            }
          >
            <Input
              ref={addressInput}
              type="url"
              value={address}
              onValueChange={setAddress}
              placeholder={t("placeholder")}
              autoComplete="off"
              mono
            />
          </Field>
          <div {...stylex.props(styles.actions, styles.formActions)}>
            <ActionButton variant="primary" type="submit" disabled={checking}>
              {checking ? t("checking") : t("connect")}
            </ActionButton>
          </div>
        </Card>
      </form>
    </Frame>
  );
}

function Unreachable({ name, url, checking }: { name: string; url: string; checking: boolean }) {
  const t = useTranslations("screens.unreachable");
  return (
    <Frame width="status" centered>
      <Mascot mood="worried" />
      <Header
        title={t("title", { name })}
        summary={checking ? t("checking") : t("summary")}
        centered
      />
      <section aria-label={t("address")} {...stylex.props(styles.infoBox)}>
        <span {...stylex.props(styles.live)}>
          <span aria-hidden="true" {...stylex.props(styles.liveDot)} />
          {t("live")}
        </span>
        <span {...stylex.props(styles.url)}>{url}</span>
        <ul {...stylex.props(styles.checks)}>
          <li {...stylex.props(styles.checkItem)}>{t("checkDevice")}</li>
          <li {...stylex.props(styles.checkItem)}>{t("checkTailscale")}</li>
        </ul>
      </section>
      <CenteredActions>
        <ActionButton variant="primary" disabled={checking} onClick={() => void api().retry()}>
          {t("retry")}
        </ActionButton>
        <ActionButton onClick={() => void api().chooseRemote()}>{t("other")}</ActionButton>
      </CenteredActions>
    </Frame>
  );
}

type RowState = "waiting" | "running" | "done" | "skipped" | "failed";

export function enrollmentRows(
  enrollment: EnrollmentPhase,
): ReadonlyArray<{ step: EnrollStep; state: RowState }> {
  const progress: SetupProgress | null =
    enrollment.phase === "running" ||
    enrollment.phase === "registered" ||
    enrollment.phase === "failed"
      ? enrollment.progress
      : null;
  const done = progress?.done ?? [];
  const next = ENROLL_STEPS.find((step) => !done.includes(step));
  const githubSkipped = progress?.github != null && progress.github !== "done";
  return ENROLL_STEPS.map((step) => ({
    step,
    state: done.includes(step)
      ? step === "github" && githubSkipped
        ? "skipped"
        : "done"
      : step !== next
        ? "waiting"
        : enrollment.phase === "running"
          ? "running"
          : enrollment.phase === "failed"
            ? "failed"
            : "waiting",
  }));
}

function RunnerEnrollment({ server, enrollment }: { server: string; enrollment: EnrollmentPhase }) {
  const t = useTranslations("screens.enrollment");
  switch (enrollment.phase) {
    case "ask":
      return (
        <Frame width="status" centered>
          <Header title={t("askTitle")} summary={t("askSummary", { server })} centered />
          <section aria-label={t("youTitle")} {...stylex.props(styles.infoBox)}>
            <span {...stylex.props(styles.youText)}>
              <Text variant="ui" tone="strong">
                {t("youTitle")}
              </Text>
              <Text variant="meta">{t("youBody")}</Text>
            </span>
          </section>
          <EnrollmentSteps enrollment={enrollment} />
          <CenteredActions>
            <ActionButton
              variant="primary"
              disabled={enrollment.accepting}
              onClick={() => void api().acceptEnrollment()}
            >
              {enrollment.accepting ? t("registering") : t("register")}
            </ActionButton>
            <ActionButton
              variant="danger"
              disabled={enrollment.accepting}
              onClick={() => void api().cancelEnrollment()}
            >
              {t("cancel")}
            </ActionButton>
          </CenteredActions>
          <Text variant="meta">{t("note")}</Text>
        </Frame>
      );
    case "running":
      return (
        <Frame width="status" centered>
          <Header title={t("runningTitle")} summary={t("runningSummary", { server })} centered />
          {enrollment.progress.waitingForRemoteLogin ? (
            <section aria-label={t("remoteLoginWaitTitle")} {...stylex.props(styles.infoBox)}>
              <span {...stylex.props(styles.youText)}>
                <Text variant="ui" tone="strong">
                  {t("remoteLoginWaitTitle")}
                </Text>
                <Text variant="meta">{t("remoteLoginWaitBody")}</Text>
              </span>
              <div {...stylex.props(styles.actions)}>
                <ActionButton size="medium" onClick={() => void api().openSharing()}>
                  {t("openSharing")}
                </ActionButton>
              </div>
            </section>
          ) : null}
          <EnrollmentSteps enrollment={enrollment} />
          <CenteredActions>
            <ActionButton
              variant="danger"
              disabled={enrollment.canceling}
              onClick={() => void api().cancelEnrollment()}
            >
              {enrollment.canceling ? t("canceling") : t("cancel")}
            </ActionButton>
          </CenteredActions>
        </Frame>
      );
    case "registered":
      return (
        <Frame width="status" centered>
          <Mascot mood="default" />
          <Header
            title={t("registeredTitle")}
            summary={t("registeredSummary", { server })}
            centered
            live
          />
          <EnrollmentSteps enrollment={enrollment} />
          {enrollment.progress.github === null || enrollment.progress.github === "done" ? null : (
            <Text variant="meta">{t(`github.${enrollment.progress.github}`)}</Text>
          )}
          <CenteredActions>
            <ActionButton variant="primary" onClick={() => void api().closeEnrollment()}>
              {t("backToServer")}
            </ActionButton>
          </CenteredActions>
        </Frame>
      );
    case "failed": {
      const problem = enrollment.progress.problem ?? "script-failed";
      return (
        <Frame width="status" centered>
          <StatusIcon tone="problem">
            <AlertIcon size={26} />
          </StatusIcon>
          <Header
            title={problem === "canceled" ? t("canceledTitle") : t("failedTitle")}
            summary={`${t(`problem.${problem}`)} ${t("failedNext")}`}
            centered
            live
          />
          <EnrollmentSteps enrollment={enrollment} />
          <CenteredActions>
            <ActionButton variant="primary" onClick={() => void api().closeEnrollment()}>
              {t("backToServer")}
            </ActionButton>
          </CenteredActions>
        </Frame>
      );
    }
    case "gone":
      return (
        <Frame width="status" centered>
          <StatusIcon tone="neutral">
            <PauseIcon />
          </StatusIcon>
          <Header title={t("goneTitle")} summary={t(`gone.${enrollment.reason}`)} centered live />
          <CenteredActions>
            <ActionButton variant="primary" onClick={() => void api().closeEnrollment()}>
              {t("backToServer")}
            </ActionButton>
          </CenteredActions>
        </Frame>
      );
  }
}

function EnrollmentSteps({ enrollment }: { enrollment: EnrollmentPhase }) {
  const t = useTranslations("screens.enrollment");
  const rows = enrollmentRows(enrollment);
  const current = rows.find((row) => row.state === "running");
  const waitingForRemoteLogin =
    enrollment.phase === "running" && enrollment.progress.waitingForRemoteLogin;
  return (
    <div {...stylex.props(styles.infoBox)}>
      <VisuallyHidden>
        <span role="status">
          {waitingForRemoteLogin
            ? t("remoteLoginWaitTitle")
            : current === undefined
              ? ""
              : t("nowRunning", { step: t(`step.${current.step}`) })}
        </span>
      </VisuallyHidden>
      <Checklist label={t("stepsLabel")}>
        {rows.map(({ step, state }) => (
          <ChecklistItem
            key={step}
            done={state === "done" || state === "skipped"}
            running={state === "running"}
            label={t(`state.${state}`)}
          >
            <span {...stylex.props(styles.stepText)}>
              <Text variant="ui" {...(state === "waiting" ? { tone: "muted" as const } : {})}>
                {t(`step.${step}`)}
              </Text>
              {state === "running" || state === "failed" || state === "skipped" ? (
                <span aria-hidden="true">
                  <Text
                    variant="meta"
                    {...(state === "failed" ? { tone: "problem" as const } : {})}
                  >
                    {t(`state.${state}`)}
                  </Text>
                </span>
              ) : null}
            </span>
          </ChecklistItem>
        ))}
      </Checklist>
    </div>
  );
}

const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });
const pulse = stylex.keyframes({ "0%, 100%": { opacity: 1 }, "50%": { opacity: 0.35 } });

const frameWidths = stylex.create({
  wide: { maxWidth: 920 },
  form: { maxWidth: 680 },
  status: { maxWidth: 560 },
});

const styles = stylex.create({
  canvas: {
    minHeight: "100vh",
    backgroundColor: colors.bgCanvas,
    color: colors.textPrimary,
    fontFamily: fonts.sans,
    fontSize: fontSize.body,
    lineHeight: lineHeight.normal,
  },
  frame: {
    boxSizing: "border-box",
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    minHeight: "100vh",
    paddingBlock: space.s10,
    paddingInline: space.s6,
  },
  frameCentered: { alignItems: "center" },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
    width: "100%",
    minWidth: 0,
  },
  statusColumn: { alignItems: "center", gap: space.s5 },
  header: { display: "flex", flexDirection: "column", gap: space.s2 },
  title: { outline: "none" },
  centerText: { textAlign: "center" },
  summary: {
    margin: 0,
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: lineHeight.relaxed,
    textWrap: "pretty",
  },
  form: { display: "contents" },
  actions: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  actionsCentered: { justifyContent: "center" },
  formActions: { paddingTop: space.s1 },
  buttonLarge: { height: 44, paddingInline: space.s5 },
  buttonMedium: { flexShrink: 0, height: 40, paddingInline: space.s4 },
  buttonWide: { width: "100%" },
  textButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.px6,
    minHeight: 40,
    paddingBlock: 0,
    paddingInline: space.s1,
    marginInline: `calc(-1 * ${space.s1})`,
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: "transparent",
    font: "inherit",
    cursor: "pointer",
    outline: { default: null, ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
    transitionProperty: "color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
  },
  textLink: {
    color: {
      default: colors.accentText,
      ":hover": { default: null, "@media (hover: hover)": colors.textPrimary },
    },
    fontSize: fontSize.ui,
    fontWeight: fontWeight.semibold,
  },
  backLink: {
    alignSelf: "flex-start",
    color: {
      default: colors.textSecondary,
      ":hover": { default: null, "@media (hover: hover)": colors.textPrimary },
    },
    fontSize: fontSize.body,
  },
  spinner: {
    display: "inline-block",
    flexShrink: 0,
    boxSizing: "border-box",
    width: 20,
    height: 20,
    borderWidth: 2,
    borderRadius: radius.full,
    borderStyle: "solid",
    borderColor: colors.accentSoft,
    borderTopColor: colors.accentText,
    animationName: { default: spin, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "0.9s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  statusBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s5,
  },
  statusIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 56,
    height: 56,
    borderRadius: radius.card,
  },
  statusIconProblem: { backgroundColor: colors.problemSoft, color: colors.problem },
  statusIconNeutral: { backgroundColor: colors.bgControl, color: colors.textSecondary },
  modes: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: space.s4,
  },
  modeIcon: { display: "inline-flex", color: colors.accentText },
  modeFooter: {
    display: "flex",
    alignItems: "center",
    minHeight: 44,
    marginTop: "auto",
    paddingTop: space.s2,
  },
  modeNote: { margin: 0, color: colors.textTertiary, fontSize: fontSize.ui },
  check: { gap: space.s3, color: colors.textPrimary, cursor: "pointer" },
  checkbox: {
    width: 18,
    height: 18,
    margin: 0,
    accentColor: colors.accent,
    cursor: "pointer",
    outline: { default: null, ":focus-visible": `2px solid ${colors.accentText}` },
    outlineOffset: 2,
  },
  listHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
    paddingBlock: space.s1,
    paddingInlineStart: space.s4,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  listEmpty: {
    display: "flex",
    alignItems: "center",
    minHeight: 52,
    paddingInline: space.s4,
    paddingBottom: space.s2,
  },
  row: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: radius.control,
  },
  rowMain: { display: "flex", alignItems: "center", gap: space.s4 },
  rowIcon: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    borderRadius: radius.control,
    backgroundColor: colors.bgControl,
    color: colors.textSecondary,
  },
  rowText: { display: "flex", flexDirection: "column", gap: space.s1, flexGrow: 1, minWidth: 0 },
  meta: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  rowNote: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.s2,
    margin: 0,
    color: colors.textSecondary,
    fontSize: fontSize.ui,
    lineHeight: lineHeight.relaxed,
  },
  moreLine: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s2,
    marginTop: `calc(-1 * ${space.s2})`,
  },
  separator: { color: colors.textTertiary },
  portForm: { maxWidth: 420 },
  portRow: { display: "flex", alignItems: "center", gap: space.s2 },
  portInput: { flexGrow: 1, minWidth: 0 },
  errorLine: { display: "flex", alignItems: "flex-start", gap: space.s2 },
  errorIcon: { display: "inline-flex", flexShrink: 0, marginTop: 1 },
  infoBox: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    width: "100%",
    paddingBlock: space.s4,
    paddingInline: space.s5,
    borderRadius: radius.card,
    backgroundColor: colors.bgCard,
    textAlign: "start",
  },
  logBox: { flexDirection: "row", alignItems: "center", paddingInline: space.s4 },
  logPath: {
    flexGrow: 1,
    minWidth: 0,
    overflowWrap: "anywhere",
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: fontSize.ui,
  },
  live: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    color: colors.textSecondary,
    fontSize: fontSize.ui,
  },
  liveDot: {
    flexShrink: 0,
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    animationName: { default: pulse, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "1.6s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  url: {
    overflowWrap: "anywhere",
    color: colors.textPrimary,
    fontFamily: fonts.mono,
    fontSize: fontSize.body,
  },
  checks: {
    display: "flex",
    flexDirection: "column",
    gap: space.px6,
    margin: 0,
    paddingTop: space.s3,
    paddingInlineStart: space.s4,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
    color: colors.textSecondary,
    lineHeight: lineHeight.relaxed,
    listStyleType: "disc",
  },
  checkItem: { paddingInlineStart: space.px2 },
  youText: { display: "flex", flexDirection: "column", gap: space.s1 },
  stepText: { display: "inline-flex", flexWrap: "wrap", alignItems: "baseline", gap: space.s2 },
});

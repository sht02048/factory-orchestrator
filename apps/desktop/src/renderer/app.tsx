import * as stylex from "@stylexjs/stylex";
import { Button, Card, Field, Input, StatusPill, Text } from "@factory/ui";
import { colors, fonts, fontSize, lineHeight, radius, space } from "@factory/ui/tokens.stylex";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { IntlProvider, useTranslations } from "use-intl";
import screens from "../../messages/ko/screens.json" with { type: "json" };
import type { DesktopApi, FindResult, FoundServerView, ViewState } from "../shared/view";

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
        <main {...stylex.props(styles.column)}>
          {view === null ? null : <Screen view={view} />}
        </main>
      </div>
    </IntlProvider>
  );
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
      return <Unreachable name={view.name} checking={view.checking} />;
  }
}

function Header({ title, summary }: { title: ReactNode; summary: ReactNode }) {
  return (
    <header {...stylex.props(styles.header)}>
      <Text variant="page">{title}</Text>
      <p {...stylex.props(styles.summary)}>{summary}</p>
    </header>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.actions)}>{children}</div>;
}

function ChooseMode() {
  const t = useTranslations("screens.chooseMode");
  const [openAtLogin, setOpenAtLogin] = useState(true);
  return (
    <>
      <Header title={t("title")} summary={t("summary")} />
      <Card>
        <Text variant="panel">{t("local.title")}</Text>
        <p {...stylex.props(styles.body)}>{t("local.body")}</p>
        <label {...stylex.props(styles.check)}>
          <input
            type="checkbox"
            checked={openAtLogin}
            onChange={(event) => setOpenAtLogin(event.currentTarget.checked)}
            {...stylex.props(styles.checkbox)}
          />
          {t("local.openAtLogin")}
        </label>
        <Actions>
          <Button variant="primary" onClick={() => void api().chooseLocal({ openAtLogin })}>
            {t("local.action")}
          </Button>
        </Actions>
      </Card>
      <Card>
        <Text variant="panel">{t("remote.title")}</Text>
        <p {...stylex.props(styles.body)}>{t("remote.body")}</p>
        <Actions>
          <Button onClick={() => void api().chooseRemote()}>{t("remote.action")}</Button>
        </Actions>
      </Card>
    </>
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
  switch (view.screen) {
    case "local-starting":
      return <Header title={t("startingTitle")} summary={t("startingSummary")} />;
    case "local-stopped":
      return (
        <>
          <Header title={t("stoppedTitle")} summary={t("stoppedSummary")} />
          <Actions>
            <Button variant="primary" onClick={() => void api().startLocal()}>
              {t("start")}
            </Button>
            <Button variant="ghost" onClick={() => void api().chooseMode()}>
              {t("otherMode")}
            </Button>
          </Actions>
        </>
      );
    case "local-failed":
      return (
        <>
          <Header title={t("failedTitle")} summary={t("failedSummary")} />
          <Card>
            <Text variant="meta" mono>
              {t("log", { path: view.logFile })}
            </Text>
          </Card>
          <Actions>
            <Button variant="primary" onClick={() => void api().retry()}>
              {t("retry")}
            </Button>
            <Button variant="ghost" onClick={() => void api().chooseMode()}>
              {t("otherMode")}
            </Button>
          </Actions>
        </>
      );
    case "local-service":
      return (
        <>
          <Header title={t("serviceTitle")} summary={t("serviceSummary")} />
          <Actions>
            <Button variant="ghost" onClick={() => void api().chooseMode()}>
              {t("otherMode")}
            </Button>
          </Actions>
        </>
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
  const servers = result?.kind === "found" ? result.servers : [];
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
    <>
      <Header title={t("title")} summary={summary} />
      {servers.length > 0 ? (
        <ul {...stylex.props(styles.list)}>
          {servers.map((server) => (
            <ServerRow key={server.instanceId} server={server} only={servers.length === 1} />
          ))}
        </ul>
      ) : null}
      <Card>
        <Field label={t("port")} description={t("portDescription")}>
          <Input value={portText} onValueChange={setPortText} mono />
        </Field>
        <Actions>
          <Button
            disabled={searching || !portValid}
            onClick={() => void api().findServers(nextPort)}
          >
            {t("retry")}
          </Button>
        </Actions>
      </Card>
      <Actions>
        <Button
          variant={servers.length > 0 ? "secondary" : "primary"}
          onClick={() => void api().showAddress()}
        >
          {t("byAddress")}
        </Button>
        <Button variant="ghost" onClick={() => void api().chooseMode()}>
          {t("back")}
        </Button>
      </Actions>
    </>
  );
}

function ServerRow({ server, only }: { server: FoundServerView; only: boolean }) {
  const t = useTranslations("screens.find");
  const openable = server.webAccess === "allowed";
  return (
    <li {...stylex.props(styles.row)}>
      <div {...stylex.props(styles.rowText)}>
        <Text variant="title">{server.name}</Text>
        <span {...stylex.props(styles.meta)}>
          <StatusPill status="online">{t("online")}</StatusPill>
          <Text variant="meta" numeric>
            {t("version", { version: server.version })}
          </Text>
          {server.versionDiffers ? <Text variant="meta">{t("versionDiffers")}</Text> : null}
        </span>
        {openable ? null : <p {...stylex.props(styles.body)}>{t("hostNotAllowed")}</p>}
      </div>
      <Button
        variant={only ? "primary" : "secondary"}
        disabled={!openable}
        onClick={() => void api().connectFound(server.instanceId)}
      >
        {t("connect")}
      </Button>
    </li>
  );
}

function EnterAddress({ checking, error }: { checking: boolean; error: string | null }) {
  const t = useTranslations("screens.address");
  const [address, setAddress] = useState("");
  const errorText =
    error === "invalid" ||
    error === "unreachable" ||
    error === "not-ours" ||
    error === "host-not-allowed"
      ? t(`errors.${error}`)
      : undefined;
  return (
    <>
      <Header title={t("title")} summary={t("summary")} />
      <form
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault();
          void api().connectAddress(address);
        }}
      >
        <Card>
          <Field label={t("label")} {...(errorText === undefined ? {} : { error: errorText })}>
            <Input
              type="url"
              value={address}
              onValueChange={setAddress}
              placeholder={t("placeholder")}
              autoComplete="off"
              mono
            />
          </Field>
          <Actions>
            <Button variant="primary" type="submit" disabled={checking || address.trim() === ""}>
              {checking ? t("checking") : t("connect")}
            </Button>
            <Button variant="ghost" onClick={() => void api().chooseRemote()}>
              {t("back")}
            </Button>
          </Actions>
        </Card>
      </form>
    </>
  );
}

function Unreachable({ name, checking }: { name: string; checking: boolean }) {
  const t = useTranslations("screens.unreachable");
  return (
    <>
      <Header title={t("title", { name })} summary={checking ? t("checking") : t("summary")} />
      <Actions>
        <Button variant="primary" disabled={checking} onClick={() => void api().retry()}>
          {t("retry")}
        </Button>
        <Button onClick={() => void api().chooseRemote()}>{t("other")}</Button>
      </Actions>
    </>
  );
}

const styles = stylex.create({
  canvas: {
    minHeight: "100vh",
    backgroundColor: colors.bgCanvas,
    color: colors.textPrimary,
    fontFamily: fonts.sans,
    fontSize: fontSize.body,
    lineHeight: lineHeight.normal,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
    maxWidth: 640,
    marginInline: "auto",
    paddingBlock: space.s10,
    paddingInline: space.s8,
  },
  header: { display: "flex", flexDirection: "column", gap: space.s2 },
  summary: {
    margin: 0,
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: lineHeight.relaxed,
  },
  form: { display: "contents" },
  body: { margin: 0, color: colors.textSecondary, lineHeight: lineHeight.relaxed },
  actions: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  check: { display: "flex", alignItems: "center", gap: space.s2, color: colors.textPrimary },
  checkbox: { margin: 0, accentColor: colors.accent, width: 16, height: 16 },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    margin: 0,
    padding: space.s2,
    listStyle: "none",
    borderRadius: radius.card,
    backgroundColor: colors.bgCard,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.s4,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": colors.bgCardHover },
  },
  rowText: { display: "flex", flexDirection: "column", gap: space.s1, flexGrow: 1, minWidth: 0 },
  meta: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
});

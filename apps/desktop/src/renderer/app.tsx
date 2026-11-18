import * as stylex from "@stylexjs/stylex";
import { Button, Dot, Field, Input, Text } from "@factory/ui";
import { colors, fonts, fontSize, lineHeight, space } from "@factory/ui/tokens.stylex";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { IntlProvider, useTranslations } from "use-intl";
import screens from "../../messages/ko/screens.json" with { type: "json" };
import type { DesktopApi, FindResult, FoundServerView, ViewState } from "../shared/view";

/*
 * 앱이 직접 그리는 화면(티켓 0046). 서버의 web 화면이 아닌 것만 여기 있다: 첫 실행 모드 선택, 서버 찾기, 주소로
 * 연결하기, 닿지 않음, 로컬 서버 상태. 상태는 main 이 정하고 여기서는 그리기만 한다.
 *
 * 모양은 리디자인 방향(운영자 UI 규칙 2026-11-18)을 따른다: 다크, 영역은 선이 아니라 면(배경색)으로 나누고,
 * 카드 12px·행 8px 둥글기, 넉넉한 글자, 제목 아래 한 줄 요약. 색·글자·간격은 @factory/ui 토큰만 쓴다.
 * 둥글기 12·8 은 아직 토큰이 없어(리디자인이 packages/ui 에 더한다) 숫자로 둔다.
 */

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

function Card({ children }: { children: ReactNode }) {
  return <section {...stylex.props(styles.card)}>{children}</section>;
}

function Row({ children }: { children: ReactNode }) {
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
        <Row>
          <Button variant="primary" onClick={() => void api().chooseLocal({ openAtLogin })}>
            {t("local.action")}
          </Button>
        </Row>
      </Card>
      <Card>
        <Text variant="panel">{t("remote.title")}</Text>
        <p {...stylex.props(styles.body)}>{t("remote.body")}</p>
        <Row>
          <Button onClick={() => void api().chooseRemote()}>{t("remote.action")}</Button>
        </Row>
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
          <Row>
            <Button variant="primary" onClick={() => void api().startLocal()}>
              {t("start")}
            </Button>
            <Button variant="ghost" onClick={() => void api().chooseMode()}>
              {t("otherMode")}
            </Button>
          </Row>
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
          <Row>
            <Button variant="primary" onClick={() => void api().retry()}>
              {t("retry")}
            </Button>
            <Button variant="ghost" onClick={() => void api().chooseMode()}>
              {t("otherMode")}
            </Button>
          </Row>
        </>
      );
    case "local-service":
      return (
        <>
          <Header title={t("serviceTitle")} summary={t("serviceSummary")} />
          <Row>
            <Button variant="ghost" onClick={() => void api().chooseMode()}>
              {t("otherMode")}
            </Button>
          </Row>
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
        <Row>
          <Button
            disabled={searching || !portValid}
            onClick={() => void api().findServers(nextPort)}
          >
            {t("retry")}
          </Button>
        </Row>
      </Card>
      <Row>
        <Button
          variant={servers.length > 0 ? "default" : "primary"}
          onClick={() => void api().showAddress()}
        >
          {t("byAddress")}
        </Button>
        <Button variant="ghost" onClick={() => void api().chooseMode()}>
          {t("back")}
        </Button>
      </Row>
    </>
  );
}

/** 주 버튼은 화면에 하나만 둔다. 서버가 하나면 그 연결이 주 행동이고, 여럿이면 모두 보조 모양이다 */
function ServerRow({ server, only }: { server: FoundServerView; only: boolean }) {
  const t = useTranslations("screens.find");
  const openable = server.webAccess === "allowed";
  return (
    <li {...stylex.props(styles.row)}>
      <div {...stylex.props(styles.rowText)}>
        <Text variant="title">{server.name}</Text>
        <span {...stylex.props(styles.meta)}>
          <span {...stylex.props(styles.pill)}>
            <Dot tone="online" />
            {t("online")}
          </span>
          <Text variant="meta" numeric>
            {t("version", { version: server.version })}
          </Text>
          {server.versionDiffers ? <Text variant="meta">{t("versionDiffers")}</Text> : null}
        </span>
        {openable ? null : <p {...stylex.props(styles.body)}>{t("hostNotAllowed")}</p>}
      </div>
      <Button
        variant={only ? "primary" : "default"}
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
        {...stylex.props(styles.card)}
        onSubmit={(event) => {
          event.preventDefault();
          void api().connectAddress(address);
        }}
      >
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
        <Row>
          <Button variant="primary" type="submit" disabled={checking || address.trim() === ""}>
            {checking ? t("checking") : t("connect")}
          </Button>
          <Button variant="ghost" onClick={() => void api().chooseRemote()}>
            {t("back")}
          </Button>
        </Row>
      </form>
    </>
  );
}

function Unreachable({ name, checking }: { name: string; checking: boolean }) {
  const t = useTranslations("screens.unreachable");
  return (
    <>
      <Header title={t("title", { name })} summary={checking ? t("checking") : t("summary")} />
      <Row>
        <Button variant="primary" disabled={checking} onClick={() => void api().retry()}>
          {t("retry")}
        </Button>
        <Button onClick={() => void api().chooseRemote()}>{t("other")}</Button>
      </Row>
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
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    padding: space.s6,
    borderRadius: 12,
    backgroundColor: colors.bgPanel,
  },
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
    borderRadius: 12,
    backgroundColor: colors.bgPanel,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.s4,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: 8,
    backgroundColor: { default: "transparent", ":hover": colors.bgHover },
  },
  rowText: { display: "flex", flexDirection: "column", gap: space.s1, flexGrow: 1, minWidth: 0 },
  meta: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.px6,
    paddingBlock: space.px2,
    paddingInline: space.s2,
    borderRadius: 6,
    backgroundColor: colors.bgRaised,
    color: colors.textSecondary,
    fontSize: fontSize.small,
  },
});

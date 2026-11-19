import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  Checkbox,
  DefinitionItem,
  DefinitionList,
  PanelBlock,
  ProblemCallout,
  Text,
  TextLink,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { serverVersionDiffers } from "@ganger/app/updates/view";
import type { UpdateAction, UpdateView } from "@ganger/app/updates/view";
import { useTranslations } from "use-intl";
import { particlesOf } from "../format/particles";
import { useTime } from "../format/time";
import { PRODUCT_VERSION } from "../identity/identity";
import { useDesktopUpdates } from "../shell/desktop-updates";

export function UpdatesPanel() {
  const updates = useDesktopUpdates();
  switch (updates.kind) {
    case "unknown":
      return null;
    case "browser":
      return <BrowserUpdates />;
    case "desktop":
      return updates.view === null ? null : (
        <DesktopUpdates view={updates.view} act={updates.act} />
      );
  }
}

export function UpdatesSummary() {
  const t = useTranslations("settings.summary");
  const updates = useDesktopUpdates();
  if (updates.kind !== "desktop" || updates.view === null) {
    return t("updatesVersion", { version: PRODUCT_VERSION });
  }
  const { check, appVersion } = updates.view;
  if (check.kind === "ready") {
    return t("updatesReady", { version: check.version, object: particlesOf(check.version).object });
  }
  return updates.view.autoUpdate
    ? t("updatesVersion", { version: appVersion })
    : t("updatesOff", { version: appVersion });
}

export function BrowserUpdates() {
  const t = useTranslations("settings.updates");
  return (
    <>
      <PanelBlock>
        <DefinitionList>
          <DefinitionItem label={t("version")}>{PRODUCT_VERSION}</DefinitionItem>
        </DefinitionList>
      </PanelBlock>
      <PanelBlock>
        <ul {...stylex.props(styles.bullets)}>
          <li>
            <Text variant="ui">{t("browserManual")}</Text>
          </li>
          <li>
            <Text variant="ui">{t("browserDesktop")}</Text>
          </li>
        </ul>
      </PanelBlock>
    </>
  );
}

export function DesktopUpdates({
  view,
  act,
}: {
  view: UpdateView;
  act: (action: UpdateAction) => void;
}) {
  const t = useTranslations("settings.updates");
  const checking = view.check.kind === "checking" || view.check.kind === "downloading";
  return (
    <>
      <PanelBlock>
        <DefinitionList>
          <DefinitionItem label={t("version")}>
            <VersionLine view={view} />
          </DefinitionItem>
          <DefinitionItem label={t("lastChecked")}>
            <span {...stylex.props(styles.checkLine)}>
              <span role="status">
                <CheckLine view={view} />
              </span>
              {view.check.kind === "unavailable" ? null : (
                <Button
                  aria-disabled={checking}
                  aria-busy={checking}
                  onClick={() => {
                    if (!checking) act("check-now");
                  }}
                >
                  {view.check.kind === "checking" ? t("checking") : t("checkNow")}
                </Button>
              )}
            </span>
          </DefinitionItem>
        </DefinitionList>
      </PanelBlock>
      <Situation view={view} act={act} />
      <PanelBlock>
        <Checkbox
          name="autoUpdate"
          label={t("auto")}
          description={t("autoDescription")}
          checked={view.autoUpdate}
          disabled={view.check.kind === "unavailable"}
          onCheckedChange={(checked) => act(checked ? "auto-on" : "auto-off")}
        />
      </PanelBlock>
    </>
  );
}

function VersionLine({ view }: { view: UpdateView }) {
  const t = useTranslations("settings.updates");
  if (view.server.version === null) return t("appOnly", { app: view.appVersion });
  if (!serverVersionDiffers(view)) return t("same", { version: view.appVersion });
  return t("differs", { app: view.appVersion, server: view.server.version });
}

function CheckLine({ view }: { view: UpdateView }) {
  const t = useTranslations("settings.updates");
  const time = useTime();
  const at = view.lastCheckedAt;
  const when =
    at === null ? t("never") : time.ago(at, Math.max(0, Date.now() - new Date(at).getTime()));
  const check = view.check;
  switch (check.kind) {
    case "unavailable":
      return t("unavailable");
    case "checking":
      return t("checkingStatus");
    case "failed":
      return t("failedStatus");
    case "idle":
      return when;
    case "latest":
      return t("latestStatus", { when });
    case "downloading":
      return t("downloadingStatus", {
        version: check.version,
        object: particlesOf(check.version).object,
      });
    case "ready":
      return t("readyStatus", {
        version: check.version,
        object: particlesOf(check.version).object,
      });
    case "manual":
      return t("manualStatus", {
        when,
        version: check.version,
        subject: particlesOf(check.version).subject,
      });
  }
}

function Situation({ view, act }: { view: UpdateView; act: (action: UpdateAction) => void }) {
  const t = useTranslations("settings.updates");
  const check = view.check;
  if (check.kind === "ready") {
    return (
      <PanelBlock>
        <Actions>
          <Button variant="primary" onClick={() => act("restart")}>
            {t("restart")}
          </Button>
          <TextLink href={check.notesUrl} external>
            {t("notes")}
          </TextLink>
        </Actions>
      </PanelBlock>
    );
  }
  if (check.kind === "manual") {
    const subject = particlesOf(check.version).subject;
    return (
      <ProblemCallout
        title={t(`manual.${check.reason}.title`)}
        actions={
          <TextLink href={check.notesUrl} external>
            {t("openRelease")}
          </TextLink>
        }
      >
        {t(`manual.${check.reason}.body`, { version: check.version, subject })}
      </ProblemCallout>
    );
  }
  if (view.server.kind !== "app" && serverVersionDiffers(view) && view.server.version !== null) {
    return (
      <ProblemCallout title={t(`serverDiffers.${view.server.kind}.title`)}>
        {t(`serverDiffers.${view.server.kind}.body`, {
          app: view.appVersion,
          server: view.server.version,
        })}
      </ProblemCallout>
    );
  }
  return null;
}

const styles = stylex.create({
  bullets: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    margin: 0,
    paddingInlineStart: space.s5,
  },
  checkLine: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s3,
    rowGap: space.s2,
  },
});

import * as stylex from "@stylexjs/stylex";
import { Card, Checkbox, ProblemCallout, Text, buttonStyles, textStyles } from "@ganger/ui";
import { colors, fonts, fontSize, lineHeight, space } from "@ganger/ui/tokens.stylex";
import { useEffect, useId, useRef, useState } from "react";
import { IntlProvider, useTranslations } from "use-intl";
import screens from "../../messages/ko/screens.json" with { type: "json" };
import { NOTIFICATION_GROUPS } from "../core/notification-prefs";
import type { NotificationGroup } from "../core/notification-prefs";
import type { NotificationSettingsApi, NotificationSettingsView } from "../shared/view";

declare global {
  interface Window {
    desktopNotifications?: NotificationSettingsApi;
  }
}

export function NotificationSettingsWindow() {
  const [view, setView] = useState<NotificationSettingsView | null>(null);
  useEffect(() => {
    const api = window.desktopNotifications;
    if (api === undefined) return;
    const off = api.onNotificationSettings(setView);
    void api.getNotificationSettings().then(setView);
    return off;
  }, []);
  return (
    <IntlProvider locale="ko" messages={{ screens }}>
      <div {...stylex.props(styles.canvas)}>
        {view === null ? null : <NotificationSettings view={view} onChange={setView} />}
      </div>
    </IntlProvider>
  );
}

export function NotificationSettings({
  view,
  onChange,
}: {
  view: NotificationSettingsView;
  onChange: (view: NotificationSettingsView) => void;
}) {
  const t = useTranslations("screens.notificationSettings");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const groupsId = useId();
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  const save = (next: NotificationSettingsView) => {
    onChange(next);
    void window.desktopNotifications?.setNotificationSettings({
      enabled: next.enabled,
      groups: next.groups,
    });
  };
  const setGroup = (group: NotificationGroup, checked: boolean) =>
    save({ ...view, groups: { ...view.groups, [group]: checked } });
  return (
    <main {...stylex.props(styles.frame)}>
      <div {...stylex.props(styles.column)}>
        <header {...stylex.props(styles.header)}>
          <h1 ref={titleRef} tabIndex={-1} {...stylex.props(...textStyles("page"), styles.title)}>
            {t("title")}
          </h1>
          <p {...stylex.props(styles.summary)}>{t("summary")}</p>
        </header>
        {view.permission === "denied" ? (
          <ProblemCallout
            title={t("permissionOff.title")}
            actions={
              <button
                type="button"
                onClick={() => void window.desktopNotifications?.openSystemNotificationSettings()}
                {...stylex.props(...buttonStyles("secondary", false), styles.button)}
              >
                {t("permissionOff.action")}
              </button>
            }
          >
            {t("permissionOff.body")}
          </ProblemCallout>
        ) : null}
        <Card padding="compact">
          <Checkbox
            label={t("enabled.label")}
            description={t("enabled.description")}
            checked={view.enabled}
            onCheckedChange={(enabled) => save({ ...view, enabled })}
          />
        </Card>
        <section aria-labelledby={groupsId} {...stylex.props(styles.section)}>
          <div {...stylex.props(styles.sectionHead)}>
            <Text variant="label" as="h2" id={groupsId}>
              {t("groupsLabel")}
            </Text>
            {view.enabled ? null : <Text variant="meta">{t("groupsOff")}</Text>}
          </div>
          <Card padding="compact">
            <div {...stylex.props(styles.groups)}>
              {NOTIFICATION_GROUPS.map((group) => (
                <Checkbox
                  key={group}
                  label={t(`groups.${group}.label`)}
                  description={t(`groups.${group}.description`)}
                  checked={view.groups[group]}
                  disabled={!view.enabled}
                  onCheckedChange={(checked) => setGroup(group, checked)}
                />
              ))}
            </div>
          </Card>
          <Text variant="meta">{t("note")}</Text>
        </section>
      </div>
    </main>
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
  frame: {
    boxSizing: "border-box",
    display: "flex",
    justifyContent: "center",
    minHeight: "100vh",
    paddingBlock: space.s8,
    paddingInline: space.s6,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
    width: "100%",
    maxWidth: 520,
    minWidth: 0,
  },
  header: { display: "flex", flexDirection: "column", gap: space.s2 },
  title: { outline: "none" },
  summary: {
    margin: 0,
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: lineHeight.relaxed,
    textWrap: "pretty",
  },
  button: { alignSelf: "flex-start" },
  section: { display: "flex", flexDirection: "column", gap: space.s3 },
  sectionHead: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
    columnGap: space.s3,
    rowGap: space.s1,
  },
  groups: { display: "flex", flexDirection: "column", gap: space.s1 },
});

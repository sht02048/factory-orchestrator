import * as stylex from "@stylexjs/stylex";
import {
  Button,
  Card,
  documentStyles,
  Checkbox,
  ProblemCallout,
  Section,
  Text,
  textStyles,
} from "@ganger/ui";
import { size, space } from "@ganger/ui/tokens.stylex";
import { useEffect, useRef, useState } from "react";
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
      <div {...stylex.props(documentStyles.body, styles.canvas)}>
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
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  const save = (next: NotificationSettingsView) => {
    onChange(next);
    window.desktopNotifications
      ?.setNotificationSettings({ enabled: next.enabled, groups: next.groups })
      .catch(() => onChange(view));
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
          <Text variant="body">{t("summary")}</Text>
        </header>
        {view.permission === "denied" ? (
          <ProblemCallout
            title={t("permissionOff.title")}
            actions={
              <Button
                onClick={() => void window.desktopNotifications?.openSystemNotificationSettings()}
              >
                {t("permissionOff.action")}
              </Button>
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
        <Section
          title={t("groupsLabel")}
          headingLevel="h2"
          {...(view.enabled ? {} : { note: t("groupsOff") })}
        >
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
        </Section>
      </div>
    </main>
  );
}

const styles = stylex.create({
  canvas: { minHeight: "100vh" },
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
    maxWidth: size.formWidth,
    minWidth: 0,
  },
  header: { display: "flex", flexDirection: "column", gap: space.s2 },
  title: { outline: "none" },
  groups: { display: "flex", flexDirection: "column", gap: space.s1 },
});

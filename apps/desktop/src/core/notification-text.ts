import { createTranslator } from "use-intl";
import system from "../../messages/ko/system.json" with { type: "json" };
import type { NotificationContent } from "./notifier.js";

const t = createTranslator({
  locale: "ko",
  messages: { system },
  namespace: "system.notifications",
});

const providers = createTranslator({ locale: "ko", messages: { system }, namespace: "system" });

function providerName(provider: string | null): string {
  if (provider === null) return "";
  return provider === "claude" || provider === "codex"
    ? providers(`providers.${provider}`)
    : provider;
}

export function notificationText(content: NotificationContent): { title: string; body: string } {
  switch (content.kind) {
    case "bundle":
      return { title: t("bundle.title"), body: t("bundle.body", { count: content.count }) };
    case "missed":
      return { title: t("missed.title"), body: t("missed.body", { count: content.count }) };
    case "event":
      break;
  }
  const { record, reminder } = content;
  const ticket = record.subject;
  const runner = record.subject;
  switch (record.kind) {
    case "question":
      return {
        title: t("question.title"),
        body: reminder ? t("question.reminder", { ticket }) : t("question.body", { ticket }),
      };
    case "permission":
      return {
        title: t("permission.title"),
        body: reminder ? t("permission.reminder", { ticket }) : t("permission.body", { ticket }),
      };
    case "human-check":
      return {
        title: t("humanCheck.title"),
        body: reminder ? t("humanCheck.reminder", { ticket }) : t("humanCheck.body", { ticket }),
      };
    case "failed":
      return { title: t("failed.title"), body: t("failed.body", { ticket }) };
    case "disconnected":
      return { title: t("disconnected.title"), body: t("disconnected.body", { ticket }) };
    case "runner-offline":
      return { title: t("runnerOffline.title"), body: t("runnerOffline.body", { runner }) };
    case "runner-auth":
      return { title: t("runnerAuth.title"), body: t("runnerAuth.body", { runner }) };
    case "runner-usage-limit":
      return {
        title: t("runnerUsageLimit.title"),
        body: t("runnerUsageLimit.body", { runner, provider: providerName(record.detail) }),
      };
  }
}

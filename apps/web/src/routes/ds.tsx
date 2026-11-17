import { createFileRoute } from "@tanstack/react-router";
import { createTranslator } from "use-intl";
import { DesignSystemPage } from "../ds/page";
import { dsMessages } from "../ds/messages";
import { ScreenMessages, defaultLocale } from "../i18n";

const t = createTranslator({ locale: defaultLocale, messages: dsMessages, namespace: "ds" });

export const Route = createFileRoute("/ds")({
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: () => (
    <ScreenMessages messages={dsMessages}>
      <DesignSystemPage />
    </ScreenMessages>
  ),
});

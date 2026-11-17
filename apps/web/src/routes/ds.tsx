import { createFileRoute } from "@tanstack/react-router";
import { DesignSystemPage } from "../ds/page";
import { t } from "../i18n";

export const Route = createFileRoute("/ds")({
  head: () => ({ meta: [{ title: t("ds.documentTitle") }] }),
  component: DesignSystemPage,
});

import * as stylex from "@stylexjs/stylex";
import { MascotMessage, Text, WindowDragStrip, buttonStyles } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { Link } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { ScreenMessages } from "../i18n";
import { notFoundMessages } from "./messages";

export function NotFoundScreen() {
  return (
    <ScreenMessages messages={notFoundMessages}>
      <NotFound />
    </ScreenMessages>
  );
}

function NotFound() {
  const t = useTranslations("notFound");
  return (
    <main {...stylex.props(styles.page)}>
      <WindowDragStrip />
      <MascotMessage mood="worried" size="large">
        <Text variant="page">{t("title")}</Text>
        <Text variant="body">{t("body")}</Text>
        <Link to="/" data-variant="secondary" {...stylex.props(...buttonStyles("secondary"))}>
          {t("home")}
        </Link>
      </MascotMessage>
    </main>
  );
}

const styles = stylex.create({
  page: {
    display: "grid",
    placeItems: "center",
    minHeight: "100dvh",
    paddingInline: space.s8,
    paddingBlock: space.s10,
  },
});

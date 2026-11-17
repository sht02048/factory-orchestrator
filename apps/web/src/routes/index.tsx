import * as stylex from "@stylexjs/stylex";
import { PageHeader } from "@factory/ui";
import { colors, space } from "@factory/ui/tokens.stylex";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const t = useTranslations("home");
  return (
    <main {...stylex.props(styles.main)}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Link to="/ds" {...stylex.props(styles.link)}>
        {t("toDs")}
      </Link>
    </main>
  );
}

const styles = stylex.create({
  main: { padding: space.s8 },
  link: { color: colors.accentText, textUnderlineOffset: 3 },
});

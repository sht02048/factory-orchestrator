import * as stylex from "@stylexjs/stylex";
import { Actions, PageHeader } from "@factory/ui";
import { colors, space } from "@factory/ui/tokens.stylex";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import home from "../../../messages/ko/home.json" with { type: "json" };
import { ScreenMessages } from "../../i18n";

// 홈의 빈 자리. 홈 화면은 티켓 0020 이 만든다.
declare module "../../i18n" {
  interface AppMessages {
    home: typeof home;
  }
}

export const Route = createFileRoute("/_app/")({
  component: () => (
    <ScreenMessages messages={{ home }}>
      <Home />
    </ScreenMessages>
  ),
});

function Home() {
  const t = useTranslations("home");
  return (
    <div {...stylex.props(styles.page)}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Actions>
        <Link to="/runs" {...stylex.props(styles.link)}>
          {t("toRuns")}
        </Link>
        <Link to="/ds" {...stylex.props(styles.link)}>
          {t("toDs")}
        </Link>
      </Actions>
    </div>
  );
}

const styles = stylex.create({
  page: { paddingTop: space.s8, paddingInline: space.s8, paddingBottom: space.s10 },
  link: { color: colors.accentText, textUnderlineOffset: 3 },
});

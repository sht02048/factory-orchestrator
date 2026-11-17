import * as stylex from "@stylexjs/stylex";
import { PageHeader, Text } from "@factory/ui";
import { space } from "@factory/ui/tokens.stylex";
import { useTranslations } from "use-intl";
import { ScreenMessages } from "../i18n";
import { placeholderMessages } from "./messages";

export type PlaceholderScreenKey = "tickets" | "runners" | "stats" | "settings";

/** 내비에는 있지만 아직 만들지 않은 화면. 각 화면 티켓이 이 라우트를 바꾼다 */
export function PlaceholderScreen({ screen }: { screen: PlaceholderScreenKey }) {
  return (
    <ScreenMessages messages={placeholderMessages}>
      <Placeholder screen={screen} />
    </ScreenMessages>
  );
}

function Placeholder({ screen }: { screen: PlaceholderScreenKey }) {
  const tNav = useTranslations("shell.nav");
  const t = useTranslations("placeholder");
  return (
    <div {...stylex.props(styles.page)}>
      <PageHeader title={tNav(screen)} />
      <Text variant="body">{t("body")}</Text>
    </div>
  );
}

const styles = stylex.create({
  page: { paddingTop: space.s8, paddingInline: space.s8, paddingBottom: space.s10 },
});

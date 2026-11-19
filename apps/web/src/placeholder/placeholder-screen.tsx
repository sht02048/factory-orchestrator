import * as stylex from "@stylexjs/stylex";
import { PageHeader, ScreenLayout, Text } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useTranslations } from "use-intl";
import { ScreenMessages } from "../i18n";
import { placeholderMessages } from "./messages";

export type PlaceholderScreenKey = "tickets" | "runners" | "stats" | "settings";

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
    <ScreenLayout header={<PageHeader title={tNav(screen)} />}>
      <div {...stylex.props(styles.page)}>
        <Text variant="body">{t("body")}</Text>
      </div>
    </ScreenLayout>
  );
}

const styles = stylex.create({
  page: { paddingTop: space.s8, paddingInline: space.s8, paddingBottom: space.s10 },
});

import * as stylex from "@stylexjs/stylex";
import { Button, NoticeLayout, PageHeader, ScreenLayout, Text, focusStyles } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";

let retryFailedPending = false;

export function takeRetryFailed(): boolean {
  const failed = retryFailedPending;
  retryFailedPending = false;
  return failed;
}

export function ScreenError(_props: ErrorComponentProps) {
  const t = useTranslations("shell.screenError");
  const router = useRouter();
  const queryErrorReset = useQueryErrorResetBoundary();
  const headingRef = useRef<HTMLDivElement>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);

  useEffect(() => {
    if (!takeRetryFailed()) return;
    setRetryFailed(true);
    headingRef.current?.focus();
  }, []);

  const retry = () => {
    if (retrying) return;
    setRetrying(true);
    setRetryFailed(false);
    queryErrorReset.reset();
    retryFailedPending = true;
    router.invalidate({ filter: (match) => match.status === "error", sync: true }).then(
      () => {
        retryFailedPending = false;
        setRetrying(false);
      },
      () => {
        setRetrying(false);
      },
    );
  };

  return (
    <ScreenLayout
      header={
        <div ref={headingRef} tabIndex={-1} {...stylex.props(focusStyles.target)}>
          <PageHeader title={t("title")} />
        </div>
      }
    >
      <NoticeLayout>
        <div {...stylex.props(styles.body)}>
          <Text variant="body">{t("body")}</Text>
          <Text variant="body" role="status">
            {retryFailed ? t("retryFailed") : ""}
          </Text>
          <div>
            <Button
              variant="secondary"
              busy={{ active: retrying, label: t("retrying") }}
              onClick={retry}
            >
              {t("retry")}
            </Button>
          </div>
        </div>
      </NoticeLayout>
    </ScreenLayout>
  );
}

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s4 },
});

import { Button, PinnedToast, TextLink } from "@ganger/ui";
import type { UpdateAction, UpdateToast as UpdateToastView } from "@ganger/app/updates/view";
import type { ServerKind } from "@ganger/app/updates/view";
import { useTranslations } from "use-intl";
import { particlesOf } from "../format/particles";

export interface UpdateToastProps {
  toast: UpdateToastView;
  serverKind: ServerKind;
  serverVersion: string | null;
  act: (action: UpdateAction) => void;
}

export function UpdateToast({ toast, serverKind, serverVersion, act }: UpdateToastProps) {
  const t = useTranslations("shell.update");
  const particles = particlesOf(toast.version);
  const ownsServer = serverKind === "app";
  if (toast.kind === "ready") {
    const title = t("ready.title", { version: toast.version, object: particles.object });
    return (
      <PinnedToast
        tone="accent"
        title={title}
        announcement={title}
        actions={
          <>
            <Button variant="primary" onClick={() => act("restart")}>
              {t("ready.restart")}
            </Button>
            <Button onClick={() => act("later")}>{t("ready.later")}</Button>
            <TextLink href={toast.notesUrl} external>
              {t("ready.notes")}
            </TextLink>
          </>
        }
      >
        {ownsServer ? t("ready.bodyWithServer") : t("ready.bodyAppOnly")}
      </PinnedToast>
    );
  }
  const title = t("updated.title", { version: toast.version, direction: particles.direction });
  const serverMatches = serverVersion === toast.version;
  return (
    <PinnedToast
      tone="progress"
      title={title}
      announcement={title}
      actions={
        <>
          <TextLink href={toast.notesUrl} external>
            {t("updated.notes")}
          </TextLink>
          <Button variant="ghost" onClick={() => act("dismiss-updated")}>
            {t("updated.close")}
          </Button>
        </>
      }
    >
      {ownsServer && serverMatches
        ? t("updated.bodyWithServer")
        : serverVersion === null || serverMatches
          ? t("updated.bodyAppOnly")
          : t("updated.bodyServerDiffers", { server: serverVersion })}
    </PinnedToast>
  );
}

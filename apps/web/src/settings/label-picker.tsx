import * as stylex from "@stylexjs/stylex";
import { Select, Text } from "@ganger/ui";
import type { SelectOption } from "@ganger/ui";
import { size, space } from "@ganger/ui/tokens.stylex";
import { useId, useState } from "react";
import { useTranslations } from "use-intl";
import { AUTO_ASSIGN_LABEL_NAME, findLabelNamed } from "@ganger/core";
import type { Choice, ConnectionLabel } from "@ganger/app/settings/model";
import { ReloadFromTracker, useLabelCreatedToast } from "./mapping-editor";
import { useReason } from "./settings-screen";
import type { ActionResult, SettingsActions } from "./settings-screen";
import { useSyncedSave } from "./synced-save";

export const CREATE_LABEL = "\u0000create";

export function useLabelReason(): (reason: string) => string {
  const t = useTranslations("settings.label");
  const reason = useReason();
  return (value) =>
    value === "rejected"
      ? t("rejected")
      : value === "repo-label"
        ? t("repoLabelRejected")
        : reason(value);
}

export function labelOptions(
  label: ConnectionLabel,
  extra: Choice | null,
  text: {
    create: (name: string) => string;
    pickExisting: (name: string) => string;
    missing: (id: string) => string;
    repoLabel: (name: string, repo: string) => string;
  },
  current: string | null,
): SelectOption[] {
  const items = label.labels.ok ? [...label.labels.items] : [];
  if (extra !== null && !items.some((item) => item.id === extra.id)) items.push(extra);
  const existing = findLabelNamed(items, AUTO_ASSIGN_LABEL_NAME);
  const existingUse =
    existing === null ? undefined : label.repoLabels.find((use) => use.labelId === existing.id);
  const first: SelectOption =
    existing === null
      ? { value: CREATE_LABEL, label: text.create(AUTO_ASSIGN_LABEL_NAME) }
      : existingUse === undefined
        ? { value: CREATE_LABEL, label: text.pickExisting(existing.name) }
        : {
            value: CREATE_LABEL,
            label: text.repoLabel(existing.name, existingUse.repo),
            disabled: true,
          };
  const options = items.map((item): SelectOption => {
    const use = label.repoLabels.find((repo) => repo.labelId === item.id);
    return use === undefined
      ? { value: item.id, label: item.name }
      : { value: item.id, label: text.repoLabel(item.name, use.repo), disabled: true };
  });
  const missing =
    current !== null && !items.some((item) => item.id === current)
      ? [{ value: current, label: text.missing(current) }]
      : [];
  return [first, ...options, ...missing];
}

export function AutoAssignLabelPicker({
  ws,
  label,
  actions,
  onSaved,
  selectLabel,
  showReload = true,
}: {
  ws: string;
  label: ConnectionLabel;
  actions: Pick<SettingsActions, "saveLabel" | "createLabel" | "reloadFromTracker">;
  onSaved?: () => void;
  selectLabel: string;
  showReload?: boolean;
}) {
  const t = useTranslations("settings.label");
  const ts = useTranslations("settings.mapping.status");
  const labelReason = useLabelReason();
  const toast = useLabelCreatedToast();
  const goneId = useId();
  const [extra, setExtra] = useState<Choice | null>(null);
  const [creating, setCreating] = useState<
    { kind: "idle" } | { kind: "sending" } | { kind: "failed"; reason: string }
  >({ kind: "idle" });
  const save = useSyncedSave<string | null>({
    saved: label.labelId,
    savedKey: label.labelId ?? "",
    send: (labelId) =>
      labelId === null
        ? Promise.resolve<ActionResult>({ ok: true })
        : actions.saveLabel({ ws, connectionId: label.connection.id, labelId }),
    onSaved: () => onSaved?.(),
  });
  const items = label.labels.ok ? label.labels.items : [];
  const known = [...items, ...(extra === null ? [] : [extra])];
  const existing = findLabelNamed(known, AUTO_ASSIGN_LABEL_NAME);
  const options = labelOptions(
    label,
    extra,
    {
      create: (name) => t("create", { name }),
      pickExisting: (name) => t("pickExisting", { name }),
      missing: (id) => t("unknown", { id }),
      repoLabel: (name, repo) => t("repoLabelUsed", { name, repo }),
    },
    save.draft,
  );
  const gone =
    label.labels.ok && save.draft !== null && !known.some((item) => item.id === save.draft);

  const createOrPick = () => {
    if (existing !== null) {
      save.choose(existing.id);
      return;
    }
    if (creating.kind === "sending") return;
    setCreating({ kind: "sending" });
    actions.createLabel({ ws, connectionId: label.connection.id }).then(
      (result) => {
        if (!result.ok) {
          setCreating({ kind: "failed", reason: result.reason });
          return;
        }
        setExtra({ id: result.labelId, name: result.name });
        save.setDraft(result.labelId);
        setCreating({ kind: "idle" });
        toast(result);
        onSaved?.();
      },
      () => setCreating({ kind: "failed", reason: "unknown" }),
    );
  };

  const statusText =
    creating.kind === "sending"
      ? t("creating")
      : creating.kind === "failed"
        ? t("createFailedStatus")
        : save.status === "idle"
          ? null
          : ts(save.status);
  const failureText =
    creating.kind === "failed"
      ? creating.reason === "rejected"
        ? t("rejected")
        : creating.reason === "unknown" || creating.reason === "failed"
          ? t("createFailedRetry", { name: AUTO_ASSIGN_LABEL_NAME })
          : t("createFailed", {
              name: AUTO_ASSIGN_LABEL_NAME,
              reason: labelReason(creating.reason),
            })
      : save.state.kind === "failed"
        ? labelReason(save.state.reason)
        : null;
  const problem = creating.kind === "failed" || save.status === "reverted";

  return (
    <div {...stylex.props(styles.picker)}>
      <div {...stylex.props(styles.controls)}>
        <span {...stylex.props(styles.select)}>
          <Select
            aria-label={selectLabel}
            {...(gone ? { "aria-describedby": goneId } : {})}
            options={options}
            value={save.draft}
            onValueChange={(value) => {
              setCreating({ kind: "idle" });
              if (value === CREATE_LABEL) createOrPick();
              else save.choose(value);
            }}
            placeholder={t("choose")}
          />
        </span>
        <Text variant="meta" role="status" {...(problem ? { tone: "problem" } : {})}>
          {statusText}
        </Text>
        {showReload ? <ReloadFromTracker onReload={actions.reloadFromTracker} /> : null}
      </div>
      {label.labels.ok ? null : (
        <Text variant="ui" as="p" tone="problem">
          {t("listFailed", { reason: labelReason(label.labels.error) })}
        </Text>
      )}
      {gone ? (
        <Text variant="ui" as="p" tone="problem" id={goneId}>
          {t("gone", { name: AUTO_ASSIGN_LABEL_NAME })}
        </Text>
      ) : null}
      {failureText === null ? null : (
        <Text variant="ui" as="p" tone="problem" role="alert">
          {failureText}
        </Text>
      )}
    </div>
  );
}

const styles = stylex.create({
  picker: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  controls: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s3,
    rowGap: space.s2,
  },
  select: { flexGrow: 1, flexBasis: size.labelSelectWidth, maxWidth: size.formWidth, minWidth: 0 },
});

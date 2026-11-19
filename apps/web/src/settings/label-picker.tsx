import * as stylex from "@stylexjs/stylex";
import { Select, Text } from "@ganger/ui";
import type { SelectOption } from "@ganger/ui";
import { size, space } from "@ganger/ui/tokens.stylex";
import { useId, useState } from "react";
import { useTranslations } from "use-intl";
import { AUTO_ASSIGN_LABEL_NAME, findLabelNamed } from "@ganger/core";
import type { Choice, ConnectionLabel } from "@ganger/app/settings/model";
import { ReloadFromTracker, SaveStatusText, useLabelCreatedToast } from "./mapping-editor";
import { useReason } from "./settings-screen";
import type { ActionResult, SettingsActions } from "./settings-screen";
import { useSyncedSave } from "./synced-save";
import type { SaveStatus } from "./synced-save";

export const CREATE_LABEL = "\u0000create";

export function useLabelReason(): (reason: string) => string {
  const t = useTranslations("settings.label");
  const reason = useReason();
  return (value) => (value === "rejected" ? t("rejected") : reason(value));
}

export function labelOptions(
  label: ConnectionLabel,
  extra: Choice | null,
  text: {
    create: (name: string) => string;
    pickExisting: (name: string) => string;
    missing: (id: string) => string;
  },
  current: string | null,
): SelectOption[] {
  const items = label.labels.ok ? [...label.labels.items] : [];
  if (extra !== null && !items.some((item) => item.id === extra.id)) items.push(extra);
  const existing = findLabelNamed(items, AUTO_ASSIGN_LABEL_NAME);
  const first: SelectOption = {
    value: CREATE_LABEL,
    label:
      existing === null ? text.create(AUTO_ASSIGN_LABEL_NAME) : text.pickExisting(existing.name),
  };
  const options = items.map((item) => ({ value: item.id, label: item.name }));
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

  const status: SaveStatus | "creating" =
    creating.kind === "sending"
      ? "creating"
      : creating.kind === "failed"
        ? "reverted"
        : save.status;
  const failure =
    creating.kind === "failed"
      ? creating.reason
      : save.state.kind === "failed"
        ? save.state.reason
        : null;

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
        {status === "creating" ? (
          <Text variant="meta" role="status">
            {t("creating")}
          </Text>
        ) : (
          <SaveStatusText status={status} />
        )}
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
      {failure === null ? null : (
        <Text variant="ui" as="p" tone="problem" role="alert">
          {labelReason(failure)}
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

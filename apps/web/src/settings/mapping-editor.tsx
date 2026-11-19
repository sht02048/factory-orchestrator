import * as stylex from "@stylexjs/stylex";
import { Button, Chip, Field, Input, Menu, MenuItem, Select, Text, showToast } from "@ganger/ui";
import type { SelectOption } from "@ganger/ui";
import { size, space } from "@ganger/ui/tokens.stylex";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { BoundProject, Choice } from "@ganger/app/settings/model";
import { useAgentName } from "../labels";
import {
  isCompleteDraft,
  labelOwner,
  mappingDraftKey,
  mappingDraftOf,
  withDefaultRepo,
  withRepoAdded,
  withRepoLabel,
  withRepoRemoved,
} from "./mapping-draft";
import type { MappingDraft, RepoDraft } from "./mapping-draft";
import { useReason, useReportUnsaved } from "./settings-screen";
import type { ActionResult, SettingsActions } from "./settings-screen";
import { useSyncedSave } from "./synced-save";
import type { SaveStatus } from "./synced-save";

const NO_LABEL = "\u0000none";
const MAPPING_TARGET = "\u0000mapping";

export function useMappingReason(): (reason: string) => string {
  const t = useTranslations("settings.mapping.error");
  const reason = useReason();
  return (value) => {
    switch (value) {
      case "label-in-use":
      case "no-repos":
      case "no-default":
      case "many-defaults":
      case "default-has-label":
      case "duplicate-repo":
        return t(value);
      default:
        return reason(value);
    }
  };
}

export function SaveStatusText({ status }: { status: SaveStatus }) {
  const t = useTranslations("settings.mapping.status");
  return (
    <Text variant="meta" role="status" {...(status === "reverted" ? { tone: "problem" } : {})}>
      {status === "idle" ? null : t(status)}
    </Text>
  );
}

type FocusAfterChange = { kind: "add" } | { kind: "make-default"; repo: string } | null;

export interface MappingEditorProps {
  ws: string;
  bound: BoundProject;
  runnerProjects: ReadonlyArray<Choice>;
  agents: ReadonlyArray<string>;
  actions: Pick<SettingsActions, "saveMapping">;
  onSaved?: () => void;
  showModel?: boolean;
  heading: ReactNode;
  children?: ReactNode;
}

export function MappingEditor({
  ws,
  bound,
  runnerProjects,
  agents,
  actions,
  onSaved,
  showModel = true,
  heading,
  children,
}: MappingEditorProps) {
  const t = useTranslations("settings.mapping");
  const mappingReason = useMappingReason();
  const agentName = useAgentName();
  const headingId = useId();
  const missingId = useId();
  const saved = mappingDraftOf(bound);
  const [target, setTarget] = useState(MAPPING_TARGET);
  const save = useSyncedSave<MappingDraft>({
    saved,
    savedKey: mappingDraftKey(saved),
    send: (draft) => sendMapping(actions, { ws, bound }, draft),
    onSaved: () => onSaved?.(),
  });
  const draft = save.draft;
  const statusTarget = draft.repos.some((repo) => repo.id === target) ? target : MAPPING_TARGET;
  const [model, setModel] = useState(draft.model);
  useEffect(() => setModel(draft.model), [draft.model]);

  const editorRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLSpanElement>(null);
  const actionRefs = useRef(new Map<string, HTMLSpanElement>());
  const [focusAfter, setFocusAfter] = useState<FocusAfterChange>(null);
  useEffect(() => {
    if (focusAfter === null) return;
    const holder =
      focusAfter.kind === "add" ? addRef.current : actionRefs.current.get(focusAfter.repo);
    const control = holder?.querySelector("button") ?? null;
    if (control !== null) {
      control.focus();
      setFocusAfter(null);
    }
  }, [focusAfter, draft]);

  const change = (next: MappingDraft, changed: string) => {
    setTarget(changed);
    if (isCompleteDraft(next)) save.choose(next);
    else save.setDraft(next);
  };
  const nameOf = (id: string) => runnerProjects.find((p) => p.id === id)?.name ?? id;
  const addable = runnerProjects.filter((p) => !draft.repos.some((repo) => repo.id === p.id));
  const failure = save.state.kind === "failed" ? save.state.reason : null;
  useEffect(() => {
    if (failure === null) return;
    const editor = editorRef.current;
    if (editor === null || editor.contains(document.activeElement)) return;
    const control =
      actionRefs.current.get(statusTarget)?.querySelector("button") ??
      addRef.current?.querySelector("button") ??
      editor.querySelector("button");
    control?.focus();
  }, [failure, statusTarget]);
  useReportUnsaved(
    (!isCompleteDraft(draft) && mappingDraftKey(draft) !== mappingDraftKey(saved)) ||
      model.trim() !== draft.model,
  );
  const missing =
    draft.repos.length === 0 && draft.agent !== null
      ? t("needRepo")
      : draft.repos.length > 0 && draft.agent === null
        ? t("needAgent")
        : null;
  const failureLine =
    failure === null ? null : (
      <Text variant="ui" as="p" tone="problem" role="alert">
        {failure === "unknown" || failure === "failed"
          ? t("revertedRetry")
          : t("reverted", { reason: mappingReason(failure) })}
      </Text>
    );
  const saveModel = () => {
    const trimmed = model.trim();
    if (trimmed === draft.model) return;
    change({ ...draft, model: trimmed }, MAPPING_TARGET);
  };

  return (
    <div ref={editorRef} role="group" aria-labelledby={headingId} {...stylex.props(styles.editor)}>
      <div {...stylex.props(styles.header)}>
        <span id={headingId}>{heading}</span>
        <SaveStatusText status={statusTarget === MAPPING_TARGET ? save.status : "idle"} />
      </div>
      {statusTarget === MAPPING_TARGET ? failureLine : null}
      <div {...stylex.props(styles.repos)}>
        <Text variant="label">{t("repos")}</Text>
        {bound.labels.ok ? null : (
          <Text variant="ui" as="p" tone="problem">
            {t("labelsFailed", { reason: mappingReason(bound.labels.error) })}
          </Text>
        )}
        {draft.repos.map((repo) => (
          <RepoRow
            key={repo.id}
            repo={repo}
            name={nameOf(repo.id)}
            draft={draft}
            bound={bound}
            nameOf={nameOf}
            status={statusTarget === repo.id ? save.status : "idle"}
            failureLine={statusTarget === repo.id ? failureLine : null}
            actionRef={(node) => {
              if (node === null) actionRefs.current.delete(repo.id);
              else actionRefs.current.set(repo.id, node);
            }}
            onLabel={(labelId) => change(withRepoLabel(draft, repo.id, labelId), repo.id)}
            onMakeDefault={() => {
              const previous = draft.repos.find((r) => r.isDefault)?.id ?? null;
              if (previous !== null) setFocusAfter({ kind: "make-default", repo: previous });
              change(withDefaultRepo(draft, repo.id), repo.id);
            }}
            onRemove={() => {
              setFocusAfter({ kind: "add" });
              change(withRepoRemoved(draft, repo.id), MAPPING_TARGET);
            }}
          />
        ))}
        {addable.length === 0 ? null : (
          <span ref={addRef} {...stylex.props(styles.add)}>
            <Menu
              label={
                draft.repos.length === 0
                  ? t("addFirstLabel", { project: bound.project.name })
                  : t("addLabel", { project: bound.project.name })
              }
              {...(draft.repos.length === 0 && missing !== null ? { describedBy: missingId } : {})}
              trigger={draft.repos.length === 0 ? t("addFirst") : t("add")}
            >
              {addable.map((p) => (
                <MenuItem
                  key={p.id}
                  value={p.id}
                  onSelect={() => change(withRepoAdded(draft, p.id), p.id)}
                >
                  {p.name}
                </MenuItem>
              ))}
            </Menu>
          </span>
        )}
        {draft.repos.length > 1 ? <Text variant="meta">{t("routeHint")}</Text> : null}
      </div>
      <div {...stylex.props(styles.fields)}>
        <Field label={t("agent")}>
          <Select
            {...(draft.agent === null && missing !== null ? { "aria-describedby": missingId } : {})}
            options={agents.map((a) => ({ value: a, label: agentName(a) }))}
            value={draft.agent}
            onValueChange={(value) => change({ ...draft, agent: value }, MAPPING_TARGET)}
            placeholder={t("choose")}
          />
        </Field>
        {showModel ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveModel();
            }}
            onBlur={saveModel}
          >
            <Field label={t("model")} description={`${t("modelDescription")} ${t("modelSave")}`}>
              <Input
                name="model"
                value={model}
                onValueChange={setModel}
                placeholder={t("modelPlaceholder")}
                autoComplete="off"
                mono
              />
            </Field>
          </form>
        ) : null}
      </div>
      {missing === null ? null : (
        <Text variant="ui" id={missingId}>
          {missing}
        </Text>
      )}
      {children}
    </div>
  );
}

function sendMapping(
  actions: Pick<SettingsActions, "saveMapping">,
  { ws, bound }: { ws: string; bound: BoundProject },
  draft: MappingDraft,
): Promise<ActionResult> {
  if (!isCompleteDraft(draft)) return Promise.resolve({ ok: true });
  return actions.saveMapping({
    ws,
    connectionId: bound.connection.id,
    projectId: bound.project.id,
    agentId: draft.agent,
    model: draft.model,
    repos: draft.repos.map((repo) => ({
      runnerProjectId: repo.id,
      isDefault: repo.isDefault,
      labelId: repo.labelId,
    })),
  });
}

function RepoRow({
  repo,
  name,
  draft,
  bound,
  nameOf,
  status,
  failureLine,
  actionRef,
  onLabel,
  onMakeDefault,
  onRemove,
}: {
  repo: RepoDraft;
  name: string;
  draft: MappingDraft;
  bound: BoundProject;
  nameOf: (id: string) => string;
  status: SaveStatus;
  failureLine: ReactNode;
  actionRef: (node: HTMLSpanElement | null) => void;
  onLabel: (labelId: string | null) => void;
  onMakeDefault: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("settings.mapping");
  const goneId = useId();
  const labels = bound.labels.ok ? bound.labels.items : [];
  const gone =
    repo.labelId !== null && bound.labels.ok && !labels.some((l) => l.id === repo.labelId);
  const options: SelectOption[] = [
    { value: NO_LABEL, label: t("noLabel") },
    ...labels.map((label): SelectOption => {
      const owner = labelOwner(draft, label.id, repo.id);
      return owner === null
        ? { value: label.id, label: label.name }
        : {
            value: label.id,
            label: t("labelUsed", { label: label.name, repo: nameOf(owner) }),
            disabled: true,
          };
    }),
    ...(repo.labelId !== null && !labels.some((l) => l.id === repo.labelId)
      ? [{ value: repo.labelId, label: t("labelMissing") }]
      : []),
  ];
  return (
    <div {...stylex.props(styles.repoBlock)}>
      <div {...stylex.props(styles.repoRow)}>
        <span {...stylex.props(styles.repoName)}>
          <Text variant="ui" tone="strong" mono wrap="anywhere">
            {name}
          </Text>
          {repo.isDefault ? <Chip strong>{t("default")}</Chip> : null}
        </span>
        <span {...stylex.props(styles.repoLabel)}>
          {repo.isDefault ? (
            <Text variant="meta">{t("defaultRoute")}</Text>
          ) : (
            <Select
              aria-label={t("repoLabel", { repo: name })}
              {...(gone ? { "aria-describedby": goneId } : {})}
              options={options}
              value={repo.labelId ?? NO_LABEL}
              onValueChange={(value) => onLabel(value === NO_LABEL ? null : value)}
            />
          )}
        </span>
        <span {...stylex.props(styles.repoStatus)}>
          <SaveStatusText status={status} />
        </span>
        <span ref={actionRef} {...stylex.props(styles.repoActions)}>
          {repo.isDefault ? null : (
            <>
              <Button aria-label={t("makeDefaultLabel", { repo: name })} onClick={onMakeDefault}>
                {t("makeDefault")}
              </Button>
              <Button
                variant="danger"
                aria-label={t("removeLabel", { repo: name })}
                onClick={onRemove}
              >
                {t("remove")}
              </Button>
            </>
          )}
        </span>
      </div>
      {gone ? (
        <Text variant="ui" as="p" tone="problem" id={goneId}>
          {t("labelGone")}
        </Text>
      ) : null}
      {repo.isDefault || repo.labelId !== null ? null : (
        <Text variant="meta">{t("noLabelRoute")}</Text>
      )}
      {failureLine}
    </div>
  );
}

export function ReloadFromTracker({ onReload }: { onReload: () => Promise<void> }) {
  const t = useTranslations("settings.mapping");
  const [state, setState] = useState<"idle" | "reading" | "done" | "failed">("idle");
  const reading = state === "reading";
  return (
    <span {...stylex.props(styles.reload)}>
      <Button
        aria-disabled={reading}
        aria-busy={reading}
        onClick={() => {
          if (reading) return;
          setState("reading");
          onReload().then(
            () => setState("done"),
            () => setState("failed"),
          );
        }}
      >
        {reading ? t("reloading") : t("reload")}
      </Button>
      <Text variant="meta" role="status" {...(state === "failed" ? { tone: "problem" } : {})}>
        {state === "done" ? t("reloaded") : state === "failed" ? t("reloadFailed") : null}
      </Text>
    </span>
  );
}

export function useLabelCreatedToast(): (result: { name: string; created: boolean }) => void {
  const t = useTranslations("settings.label");
  return (result) =>
    showToast(
      result.created ? t("created", { name: result.name }) : t("picked", { name: result.name }),
    );
}

const styles = stylex.create({
  editor: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.s2,
  },
  repos: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  repoBlock: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  repoRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s3,
    rowGap: space.s2,
    minWidth: 0,
  },
  repoName: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    flexGrow: 1,
    flexBasis: size.mappingCellMinWidth,
    minWidth: 0,
  },
  repoLabel: {
    flexGrow: 1,
    flexBasis: size.labelSelectWidth,
    minWidth: size.mappingCellMinWidth,
  },
  repoStatus: { flexShrink: 0, minWidth: size.saveStatusColumn },
  repoActions: { display: "inline-flex", gap: space.s2, flexShrink: 0 },
  add: { display: "block", maxWidth: size.repoSelectWidth },
  fields: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(min(${size.fieldMinWidth}, 100%), 1fr))`,
    gap: space.s3,
  },
  reload: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
});

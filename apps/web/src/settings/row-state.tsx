import { Text } from "@ganger/ui";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "use-intl";
import { useReason, type ActionResult } from "./settings-screen";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "reverted";

export interface AutoSave<T> {
  value: T;
  status: AutoSaveStatus;
  error: string | null;
  change: (value: T) => void;
}

export function useAutoSave<T>(saved: T, save: (value: T) => Promise<ActionResult>): AutoSave<T> {
  const [pending, setPending] = useState<{ value: T } | null>(null);
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const change = useCallback(
    (value: T) => {
      const attempt = latest.current + 1;
      latest.current = attempt;
      setPending({ value });
      setStatus("saving");
      setError(null);
      const settle = (result: ActionResult) => {
        if (latest.current !== attempt) return;
        setPending(null);
        if (result.ok) {
          setStatus("saved");
        } else {
          setStatus("reverted");
          setError(result.reason);
        }
      };
      save(value).then(settle, () => settle({ ok: false, reason: "unknown" }));
    },
    [save],
  );
  return { value: pending === null ? saved : pending.value, status, error, change };
}

export function AutoSaveStatusText({ status }: { status: AutoSaveStatus }) {
  const t = useTranslations("settings.status");
  return status === "idle" ? null : t(status);
}

export function RevertedMessage({ error }: { error: string | null }) {
  const t = useTranslations("settings");
  const reason = useReason();
  if (error === null) return null;
  const known = reason(error);
  return (
    <Text variant="meta" as="p" tone="problem" role="alert">
      {known === t("failed") ? t("revertedRetry") : t("revertedReason", { reason: known })}
    </Text>
  );
}

interface EditorSlot {
  openId: string | null;
  setOpenId: (id: string | null) => void;
}

const EditorContext = createContext<EditorSlot>({ openId: null, setOpenId: () => {} });

export function EditorProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const value = useMemo(() => ({ openId, setOpenId }), [openId]);
  return <EditorContext value={value}>{children}</EditorContext>;
}

export interface InlineEdit {
  open: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  show: () => void;
  close: () => void;
}

export function useInlineEdit(id: string): InlineEdit {
  const { openId, setOpenId } = use(EditorContext);
  const open = openId === id;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (open || !refocus.current) return;
    refocus.current = false;
    triggerRef.current?.focus();
  }, [open]);
  const show = useCallback(() => setOpenId(id), [id, setOpenId]);
  const close = useCallback(() => {
    refocus.current = true;
    setOpenId(null);
  }, [setOpenId]);
  return { open, triggerRef, show, close };
}

export function useFocusFirstField(): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>("input:not([readonly]):not([disabled]), button:not([disabled])")
      ?.focus();
  }, []);
  return ref;
}

import { useEffect, useRef, useState } from "react";
import { createSerialSaver } from "./serial-save";
import type { ActionResult, SubmitState } from "./settings-screen";

export type SaveStatus = "idle" | "saving" | "saved" | "reverted";

export function saveStatusOf(state: SubmitState, savedOnce: boolean): SaveStatus {
  switch (state.kind) {
    case "sending":
      return "saving";
    case "failed":
      return "reverted";
    case "idle":
      return savedOnce ? "saved" : "idle";
  }
}

export function useSyncedSave<V>({
  saved,
  savedKey,
  send,
  onSaved,
}: {
  saved: V;
  savedKey: string;
  send: (value: V) => Promise<ActionResult>;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(saved);
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [savedOnce, setSavedOnce] = useState(false);
  const latest = useRef({ saved, send, onSaved });
  useEffect(() => {
    latest.current = { saved, send, onSaved };
  });
  const [saver] = useState(() =>
    createSerialSaver<V>({
      send: (value) => latest.current.send(value),
      revert: () => setDraft(latest.current.saved),
      onState: setState,
      onSaved: () => {
        setSavedOnce(true);
        latest.current.onSaved();
      },
    }),
  );
  const sending = useRef(false);
  sending.current = state.kind === "sending";
  useEffect(() => {
    if (!sending.current) setDraft(latest.current.saved);
  }, [savedKey]);
  return {
    draft,
    setDraft,
    state,
    status: saveStatusOf(state, savedOnce),
    choose: (value: V) => {
      setDraft(value);
      saver.choose(value);
    },
  };
}

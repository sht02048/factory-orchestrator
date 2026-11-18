import type { ActionResult, SubmitState } from "../settings/settings-screen";

export interface SerialSaveHandlers<V> {
  send: (value: V) => Promise<ActionResult>;
  revert: () => void;
  onState: (state: SubmitState) => void;
  onSaved: () => void;
}

export function createSerialSaver<V>(handlers: SerialSaveHandlers<V>): {
  choose: (value: V) => void;
} {
  let queued: { value: V } | null = null;
  let running = false;

  const finish = (failure: string | null) => {
    if (queued !== null) {
      sendNext();
      return;
    }
    running = false;
    if (failure === null) {
      handlers.onState({ kind: "idle" });
      return;
    }
    handlers.revert();
    handlers.onState({ kind: "failed", reason: failure });
  };

  const sendNext = () => {
    const item = queued;
    if (item === null) return;
    queued = null;
    running = true;
    handlers.onState({ kind: "sending" });
    handlers.send(item.value).then(
      (result) => {
        if (result.ok) handlers.onSaved();
        finish(result.ok ? null : result.reason);
      },
      () => finish("unknown"),
    );
  };

  return {
    choose: (value) => {
      queued = { value };
      if (!running) sendNext();
    },
  };
}

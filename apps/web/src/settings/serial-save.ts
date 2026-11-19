import type { ActionResult, SubmitState } from "./settings-screen";

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
    Promise.resolve()
      .then(() => handlers.send(item.value))
      .then(
        (result) => {
          try {
            if (result.ok) handlers.onSaved();
          } finally {
            finish(result.ok ? null : result.reason);
          }
        },
        () => finish("unknown"),
      )
      .catch(() => {});
  };

  return {
    choose: (value) => {
      queued = { value };
      if (!running) sendNext();
    },
  };
}

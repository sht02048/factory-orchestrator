import { WORKER_WAKE_MESSAGE, isWorkerWakeEnabled } from "@ganger/core";
import type { WorkerWakeMessage } from "@ganger/core";

export interface WakeChannel {
  env: Readonly<Record<string, string | undefined>>;
  connected: boolean;
  send?: (message: WorkerWakeMessage, callback: (error: Error | null) => void) => boolean;
}

const ignoreSendFailure = (): void => undefined;

export function wakeWorkerVia(channel: WakeChannel): void {
  if (!isWorkerWakeEnabled(channel.env) || !channel.connected) return;
  channel.send?.(WORKER_WAKE_MESSAGE, ignoreSendFailure);
}

export function wakeWorker(): void {
  wakeWorkerVia(process);
}

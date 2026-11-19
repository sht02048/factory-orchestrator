declare global {
  var __gangerE2eWakeWorker: (() => void) | undefined;
}

export function wakeWorker(): void {
  globalThis.__gangerE2eWakeWorker?.();
}

export function wakeWorker(): void {
  globalThis.__gangerDev?.runtime?.wake();
}

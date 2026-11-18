import { dirname } from "node:path";

export interface OpenLogDeps {
  exists(path: string): boolean;
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
}

export async function openLog(logFile: string, deps: OpenLogDeps): Promise<void> {
  if (!deps.exists(logFile)) {
    await deps.openPath(dirname(logFile));
    return;
  }
  const error = await deps.openPath(logFile);
  if (error !== "") deps.showItemInFolder(logFile);
}

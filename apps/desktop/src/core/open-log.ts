import { dirname } from "node:path";

export interface OpenLogDeps {
  exists(path: string): boolean;
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
}

function nearestExistingFolder(path: string, exists: (path: string) => boolean): string {
  let folder = dirname(path);
  while (!exists(folder) && dirname(folder) !== folder) folder = dirname(folder);
  return folder;
}

export async function openLog(logFile: string, deps: OpenLogDeps): Promise<void> {
  if (!deps.exists(logFile)) {
    await deps.openPath(nearestExistingFolder(logFile, (path) => deps.exists(path)));
    return;
  }
  const error = await deps.openPath(logFile);
  if (error !== "") deps.showItemInFolder(logFile);
}

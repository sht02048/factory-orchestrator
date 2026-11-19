import { accessSync, constants } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ManualReason } from "@ganger/app/updates/view";
import { app, autoUpdater } from "electron";
import { blockedReason } from "../core/update-config.js";
import type { Installer } from "../core/updater.js";

export interface InstallerEvents {
  downloaded(): void;
  failed(error: Error): void;
  beforeInstall(): void;
}

export function squirrelInstaller(events: InstallerEvents): Installer {
  autoUpdater.on("update-downloaded", () => events.downloaded());
  autoUpdater.on("update-not-available", () => events.failed(new Error("no update in the feed")));
  autoUpdater.on("error", (error) => events.failed(error));
  return {
    download(feedUrl) {
      autoUpdater.setFeedURL({ url: feedUrl, serverType: "json" });
      autoUpdater.checkForUpdates();
    },
    install() {
      events.beforeInstall();
      autoUpdater.quitAndInstall();
    },
  };
}

export function installBlock(): ManualReason | null {
  const bundle = resolve(app.getPath("exe"), "..", "..", "..");
  return blockedReason({
    inApplications: app.isInApplicationsFolder(),
    writable: canWrite(bundle) && canWrite(dirname(bundle)),
  });
}

function canWrite(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

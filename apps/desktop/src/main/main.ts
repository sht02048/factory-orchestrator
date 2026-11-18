import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveHome } from "@ganger/cli/home";
import { app, dialog } from "electron";
import { z } from "zod";
import { LocalServer, fileRecordStore } from "../core/local-server.js";
import { SERVER_BUNDLE_ENV, loadServerBundle } from "../core/server-bundle.js";
import { serviceInstalledFor } from "../core/service.js";
import { fileSettingsStore } from "../core/settings.js";
import { Controller, appPaths } from "./controller.js";

const USER_DATA_ENV = "FACTORY_DESKTOP_USER_DATA";

const userData = process.env[USER_DATA_ENV]?.trim();
if (userData !== undefined && userData.length > 0) app.setPath("userData", resolve(userData));

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  let controller: Controller | undefined;
  app.on("second-instance", () => controller?.showWindow());
  app.on("activate", () => controller?.showWindow());
  app.on("window-all-closed", () => undefined);
  app.on("before-quit", () => {
    if (controller !== undefined) controller.quitting = true;
  });

  void app.whenReady().then(() => {
    let bundle;
    try {
      bundle = loadServerBundle(serverBundleRoot());
    } catch (error) {
      dialog.showErrorBox(
        "Factory Orchestrator",
        error instanceof Error ? error.message : String(error),
      );
      app.exit(1);
      return;
    }
    const home = resolveHome(undefined, process.env, homedir());
    const data = app.getPath("userData");
    const logFile = join(home, "logs", "desktop-server.log");
    const local = new LocalServer({
      home,
      bundle,
      node: { command: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
      bundleRoot: bundle.root,
      records: fileRecordStore(join(data, "server-process.json")),
      logFile,
      serviceInstalled: () => serviceInstalledFor(home, homedir()),
    });
    controller = new Controller({
      settings: fileSettingsStore(join(data, "settings.json")),
      local,
      serverVersion: bundle.version,
      logFile,
      ...appPaths(app.getAppPath()),
      openedAtLogin: app.getLoginItemSettings().wasOpenedAtLogin === true,
    });
    controller.start();
  });
}

function serverBundleRoot(): string {
  const override = process.env[SERVER_BUNDLE_ENV]?.trim();
  if (override !== undefined && override.length > 0) return resolve(override);
  if (app.isPackaged) return join(process.resourcesPath, "server");
  const repo = resolve(app.getAppPath(), "..", "..");
  const version = z
    .object({ version: z.string() })
    .safeParse(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")));
  const named = join(
    repo,
    "dist",
    `factory-orchestrator-${version.success ? version.data.version : "0.0.0"}`,
  );
  if (existsSync(named)) return named;
  const any = existsSync(join(repo, "dist"))
    ? readdirSync(join(repo, "dist")).find(
        (name) => /^factory-orchestrator-[^/]+$/.test(name) && !name.endsWith(".tar.gz"),
      )
    : undefined;
  return any === undefined ? named : join(repo, "dist", any);
}

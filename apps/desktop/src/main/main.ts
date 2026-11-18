import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveHome } from "@factory/cli/home";
import { app, dialog } from "electron";
import { z } from "zod";
import { LocalServer, fileRecordStore } from "../core/local-server.js";
import { SERVER_BUNDLE_ENV, loadServerBundle } from "../core/server-bundle.js";
import { serviceInstalledFor } from "../core/service.js";
import { fileSettingsStore } from "../core/settings.js";
import { Controller, appPaths } from "./controller.js";

/*
 * 데스크톱 앱(①) 진입점(티켓 0046). 창·트레이·알림만 맡고, 서버(②)는 앱에 실린 서버 배포물을 앱 실행 파일의 Node 로
 * 따로 띄운다(core/local-server.ts). 앱을 끝내도 ②는 계속 돈다.
 *
 * 환경 변수:
 * - FACTORY_HOME: 서버 home(CLI 와 같다). 없으면 ~/.factory-orchestrator
 * - FACTORY_SERVER_BUNDLE: 개발 실행에서 쓸 서버 배포물 폴더. 없으면 저장소 dist/ 의 배포물
 * - FACTORY_DESKTOP_USER_DATA: 앱 데이터 폴더(설정, ② 기록). 시험과 여러 설정을 나눠 쓸 때
 * - FACTORY_TAILSCALE_CLI: Tailscale CLI 경로(core/tailscale.ts)
 */

const USER_DATA_ENV = "FACTORY_DESKTOP_USER_DATA";

const userData = process.env[USER_DATA_ENV]?.trim();
if (userData !== undefined && userData.length > 0) app.setPath("userData", resolve(userData));

// 같은 앱이 두 번 뜨면 뒤에 뜬 쪽은 앞 창을 앞으로 가져오고 끝난다.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  let controller: Controller | undefined;
  app.on("second-instance", () => controller?.showWindow());
  app.on("activate", () => controller?.showWindow());
  // 창을 모두 닫아도 트레이에 남는다.
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
      // ②는 앱 실행 파일을 Node 로 써서 띄운다(Electron runAsNode fuse 를 켜 둔다, 티켓 0046).
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

/** 패키징한 앱은 Resources/server, 개발 실행은 저장소 dist/ 의 배포물 */
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

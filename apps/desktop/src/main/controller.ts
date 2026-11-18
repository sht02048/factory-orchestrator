import { join } from "node:path";
import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  ipcMain,
  nativeImage,
  shell,
} from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent, MenuItemConstructorOptions } from "electron";
import { createTranslator } from "use-intl";
import system from "../../messages/ko/system.json" with { type: "json" };
import { AttentionDiff, attentionPath, fetchAttention } from "../core/attention.js";
import type { AttentionEvent } from "../core/attention.js";
import { DEFAULT_SERVER_PORT, discoverServers } from "../core/discovery.js";
import type { DiscoveryResult, FoundServer } from "../core/discovery.js";
import { probeIdentity } from "../core/identity.js";
import type { EnsureResult, LocalServer } from "../core/local-server.js";
import { connectAddress, reopenSaved, savedFromFound } from "../core/remote.js";
import type { SavedServer } from "../core/remote.js";
import type { SettingsStore } from "../core/settings.js";
import { ServerWatch } from "../core/watch.js";
import type { WatchState } from "../core/watch.js";
import type { FindResult, ViewState } from "../shared/view.js";
import { IPC_PREFIX, VIEW_CHANNEL } from "../shared/view.js";

/*
 * 앱(①)의 상태와 행동. 창 하나가 앱 화면(renderer)과 서버의 web 화면을 번갈아 연다(Q1). 트레이·메뉴 막대·알림을
 * 여기서 맞춘다.
 *
 * - 로컬 모드: LocalServer 로 ②에 붙거나 띄우고, ServerWatch 가 앱이 열린 동안 ②를 지킨다.
 * - 원격 모드: 저장한 서버를 열고, 닿지 않으면 "닿지 않음" 화면에서 5초마다 다시 본다.
 * - 알림: 연 서버의 `/api/attention` 을 15초마다 폴링한다(로컬·원격 같음).
 */

const t = createTranslator({ locale: "ko", messages: { system }, namespace: "system" });

const ATTENTION_INTERVAL_MS = 15_000;
const REMOTE_RETRY_MS = 5_000;

export interface ControllerOptions {
  settings: SettingsStore;
  local: LocalServer;
  /** 앱에 실린 서버 배포물 버전. ③과 다르면 알린다 */
  serverVersion: string;
  logFile: string;
  rendererFile: string;
  preloadFile: string;
  trayIcon: string;
  /** 로그인 때 실행으로 열렸다. 창을 띄우지 않는다 */
  openedAtLogin: boolean;
}

type Mode = "choosing" | "local" | "remote";

export class Controller {
  private readonly options: ControllerOptions;
  private window: BrowserWindow | undefined;
  private tray: Tray | undefined;
  private view: ViewState = { screen: "choose-mode" };
  private mode: Mode = "choosing";
  /** 창이 연 서버 주소. 앱 화면을 보이면 undefined */
  private serverUrl: string | undefined;
  private readonly watch: ServerWatch;
  private readonly diff = new AttentionDiff();
  /** 알림 기준(diff)이 어느 서버의 것인가 */
  private diffUrl: string | undefined;
  private attentionTimer: NodeJS.Timeout | undefined;
  private remoteTimer: NodeJS.Timeout | undefined;
  private found: FoundServer[] = [];
  private remote: { server: SavedServer; reachable: boolean } | undefined;
  private notifiedVersion = false;
  quitting = false;

  constructor(options: ControllerOptions) {
    this.options = options;
    this.watch = new ServerWatch(options.local, { onChange: (state) => this.onWatch(state) });
  }

  start(): void {
    this.registerIpc();
    this.tray = new Tray(nativeImage.createFromPath(this.options.trayIcon));
    this.tray.setToolTip(t("tray.tooltip"));
    this.attentionTimer = setInterval(() => void this.pollAttention(), ATTENTION_INTERVAL_MS);
    const settings = this.options.settings.read();
    if (!this.options.openedAtLogin || settings.mode === undefined) this.showWindow();
    switch (settings.mode) {
      case "local":
        void this.startLocal();
        break;
      case "remote":
        if (settings.remote === undefined) void this.chooseRemote();
        else void this.openRemote(settings.remote);
        break;
      case undefined:
        this.setView({ screen: "choose-mode" });
        break;
    }
    this.refreshMenus();
  }

  showWindow(): void {
    const window = this.ensureWindow();
    window.show();
    window.focus();
  }

  /** 트레이 "서버도 끄고 종료": 앱이 띄운 ②까지 멈춘다. ③은 멈추지 않는다 */
  async quitWithServer(): Promise<void> {
    this.watch.stop();
    this.watch.setWanted(false);
    if (this.mode === "local") await this.options.local.stop();
    this.quit();
  }

  /** 트레이 "종료": 앱만 끝낸다. ②는 계속 돈다 */
  quit(): void {
    this.quitting = true;
    this.watch.stop();
    if (this.attentionTimer !== undefined) clearInterval(this.attentionTimer);
    this.stopRemoteRetry();
    app.quit();
  }

  // ── 로컬 모드 ──────────────────────────────────────────────

  private async startLocal(): Promise<void> {
    this.mode = "local";
    this.stopRemoteRetry();
    this.watch.setWanted(true);
    this.setView({ screen: "local-starting" });
    this.refreshMenus();
    const result = await this.options.local.ensureRunning();
    this.watch.adopt(result);
    this.watch.start();
    this.afterEnsure(result);
  }

  private afterEnsure(result: EnsureResult): void {
    if (result.kind !== "running") return;
    const { status } = result;
    if (status.owner === "external" && status.identity.version !== this.options.serverVersion) {
      this.notifyVersion(status.identity.version);
    }
  }

  private async stopLocal(): Promise<void> {
    this.watch.setWanted(false);
    const result = await this.options.local.stop();
    if (result.ok) this.setView({ screen: "local-stopped" });
    await this.watch.tick();
  }

  private async restartLocal(): Promise<void> {
    this.watch.setWanted(true);
    this.setView({ screen: "local-starting" });
    const result = await this.options.local.ensureRunning();
    this.watch.adopt(result);
    this.afterEnsure(result);
  }

  private onWatch(state: WatchState): void {
    if (this.mode !== "local") return;
    switch (state.kind) {
      case "running":
        if (this.serverUrl !== state.status.url) this.openServer(state.status.url);
        break;
      case "starting":
        break;
      case "stopped":
        if (state.owner === "external") this.setView({ screen: "local-service" });
        else if (this.view.screen !== "local-starting") this.setView({ screen: "local-stopped" });
        break;
      case "failed":
        this.setView({ screen: "local-failed", logFile: this.options.logFile });
        break;
    }
    this.refreshMenus();
  }

  // ── 원격 모드 ──────────────────────────────────────────────

  private async chooseRemote(): Promise<void> {
    this.mode = "remote";
    this.stopRemoteRetry();
    this.refreshMenus();
    await this.findServers(this.options.settings.read().discoveryPort ?? DEFAULT_SERVER_PORT);
  }

  private async findServers(port: number): Promise<void> {
    const settings = this.options.settings.read();
    if (port !== (settings.discoveryPort ?? DEFAULT_SERVER_PORT)) {
      this.options.settings.write({ ...settings, discoveryPort: port });
    }
    this.setView({ screen: "find-servers", port, searching: true, result: null });
    const result = await discoverServers({ port });
    this.found = result.kind === "found" ? result.servers : [];
    if (this.view.screen === "find-servers") {
      this.setView({
        screen: "find-servers",
        port,
        searching: false,
        result: this.findView(result),
      });
    }
  }

  private findView(result: DiscoveryResult): FindResult {
    if (result.kind !== "found") return { kind: result.kind };
    return {
      kind: "found",
      servers: result.servers.map((server) => ({
        ...server,
        versionDiffers: server.version !== this.options.serverVersion,
      })),
    };
  }

  private connectFound(instanceId: string): void {
    const server = this.found.find((candidate) => candidate.instanceId === instanceId);
    if (server === undefined || server.webAccess !== "allowed") return;
    this.useRemote(savedFromFound(server));
  }

  private async connectAddress(address: string): Promise<void> {
    this.setView({ screen: "enter-address", checking: true, error: null });
    const result = await connectAddress(address, (origin, timeoutMs) =>
      probeIdentity(origin, timeoutMs),
    );
    if (result.ok) this.useRemote(result.server);
    else this.setView({ screen: "enter-address", checking: false, error: result.reason });
  }

  private useRemote(server: SavedServer): void {
    const settings = this.options.settings.read();
    this.options.settings.write({ ...settings, mode: "remote", remote: server });
    this.mode = "remote";
    this.remote = { server, reachable: true };
    this.watch.stop();
    this.openServer(server.url);
  }

  private async openRemote(saved: SavedServer): Promise<void> {
    this.mode = "remote";
    this.remote = { server: saved, reachable: false };
    this.setView({ screen: "unreachable", name: saved.name, checking: true });
    const port = this.options.settings.read().discoveryPort ?? DEFAULT_SERVER_PORT;
    const result = await reopenSaved(saved, {
      probe: (origin, timeoutMs) => probeIdentity(origin, timeoutMs),
      discover: () => discoverServers({ port }),
    });
    if (this.mode !== "remote" || this.remote?.server.instanceId !== saved.instanceId) return;
    if (result.kind === "open") {
      this.stopRemoteRetry();
      this.useRemote(result.server);
      return;
    }
    this.remote = { server: saved, reachable: false };
    this.setView({ screen: "unreachable", name: saved.name, checking: false });
    this.refreshMenus();
    // 닿으면 사람이 누르지 않아도 연다.
    this.remoteTimer ??= setInterval(() => {
      if (this.view.screen === "unreachable" && !this.view.checking && this.remote !== undefined) {
        void this.openRemote(this.remote.server);
      }
    }, REMOTE_RETRY_MS);
  }

  private stopRemoteRetry(): void {
    if (this.remoteTimer !== undefined) clearInterval(this.remoteTimer);
    this.remoteTimer = undefined;
  }

  // ── 화면 ──────────────────────────────────────────────────

  private chooseMode(): void {
    this.mode = "choosing";
    this.stopRemoteRetry();
    this.watch.stop();
    this.setView({ screen: "choose-mode" });
    this.refreshMenus();
  }

  private chooseLocal(openAtLogin: boolean): void {
    const settings = this.options.settings.read();
    this.options.settings.write({ ...settings, mode: "local", openAtLogin });
    this.applyLoginItem(openAtLogin);
    void this.startLocal();
  }

  private applyLoginItem(openAtLogin: boolean): void {
    // 개발 실행(electron .)에서 등록하면 Electron 실행 파일이 로그인 항목에 남는다. 패키징한 앱에서만 한다.
    if (!app.isPackaged) return;
    app.setLoginItemSettings({ openAtLogin });
  }

  private setView(view: ViewState): void {
    this.view = view;
    const window = this.window;
    if (window === undefined || window.isDestroyed()) return;
    if (this.serverUrl !== undefined) {
      // 알림 기준은 그대로 둔다. 같은 서버를 다시 열면 그사이 생긴 사건을 알린다(openServer 는 다른 서버일 때만 지운다).
      this.serverUrl = undefined;
      void window.loadFile(this.options.rendererFile);
      return;
    }
    window.webContents.send(VIEW_CHANNEL, view);
  }

  private openServer(url: string, path = "/"): void {
    if (this.diffUrl !== url) {
      this.diff.reset();
      this.diffUrl = url;
    }
    this.serverUrl = url;
    this.refreshMenus();
    void this.pollAttention();
    const window = this.window;
    if (window === undefined || window.isDestroyed()) return;
    void window.loadURL(new URL(path, url).toString());
  }

  private ensureWindow(): BrowserWindow {
    if (this.window !== undefined && !this.window.isDestroyed()) return this.window;
    const window = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 720,
      minHeight: 520,
      show: false,
      title: "Factory Orchestrator",
      webPreferences: {
        preload: this.options.preloadFile,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    window.once("ready-to-show", () => window.show());
    // 창을 닫아도 앱은 트레이에 남는다(Q5). 끝내기는 트레이·메뉴의 "종료".
    window.on("close", (event) => {
      if (this.quitting) return;
      event.preventDefault();
      window.hide();
    });
    // 서버 화면 밖으로 나가는 링크(PR, 트래커)는 브라우저로 연다.
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (this.isAppScreen(url)) return;
      if (this.serverUrl !== undefined && new URL(url).origin === new URL(this.serverUrl).origin)
        return;
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    });
    window.webContents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
      // 서버가 멈춘 사이 연 화면이면 상태에 맞는 앱 화면으로 돌린다.
      if (!isMainFrame || code === -3 || this.isAppScreen(url)) return;
      if (this.mode === "remote" && this.remote !== undefined)
        void this.openRemote(this.remote.server);
      else if (this.mode === "local") void this.watch.tick();
    });
    this.window = window;
    if (this.serverUrl !== undefined) void window.loadURL(this.serverUrl);
    else void window.loadFile(this.options.rendererFile);
    return window;
  }

  private isAppScreen(url: string): boolean {
    return url.startsWith("file:");
  }

  private registerIpc(): void {
    const fromAppScreen = (event: IpcMainInvokeEvent | IpcMainEvent): boolean =>
      event.senderFrame !== null && this.isAppScreen(event.senderFrame.url);
    const handle = (action: string, run: (...args: unknown[]) => unknown): void => {
      ipcMain.handle(`${IPC_PREFIX}${action}`, async (event, ...args: unknown[]) => {
        if (!fromAppScreen(event)) return;
        await run(...args);
      });
    };
    ipcMain.on(`${IPC_PREFIX}request-view`, (event) => {
      if (fromAppScreen(event)) event.sender.send(VIEW_CHANNEL, this.view);
    });
    handle("choose-local", (options) =>
      this.chooseLocal(
        typeof options === "object" && options !== null && "openAtLogin" in options
          ? options.openAtLogin !== false
          : true,
      ),
    );
    handle("choose-remote", () => this.chooseRemote());
    handle("find-servers", (port) =>
      this.findServers(
        typeof port === "number" && Number.isInteger(port) ? port : DEFAULT_SERVER_PORT,
      ),
    );
    handle("connect-found", (instanceId) => {
      if (typeof instanceId === "string") this.connectFound(instanceId);
    });
    handle("show-address", () =>
      this.setView({ screen: "enter-address", checking: false, error: null }),
    );
    handle("connect-address", (address) =>
      typeof address === "string" ? this.connectAddress(address) : undefined,
    );
    handle("start-local", () => this.restartLocal());
    handle("retry", () => {
      if (this.mode === "local") return this.restartLocal();
      if (this.remote !== undefined) return this.openRemote(this.remote.server);
      return this.chooseRemote();
    });
    handle("choose-mode", () => this.chooseMode());
  }

  // ── 알림 ──────────────────────────────────────────────────

  private async pollAttention(): Promise<void> {
    const url = this.serverUrl;
    if (url === undefined) return;
    const events = await fetchAttention(url);
    if (events === undefined || url !== this.serverUrl) return;
    for (const event of this.diff.next(events)) this.notify(event, url);
  }

  private notify(event: AttentionEvent, url: string): void {
    if (!Notification.isSupported()) return;
    const { title, body } = notificationText(event);
    const notification = new Notification({ title, body });
    notification.on("click", () => {
      this.showWindow();
      // 앱 화면을 보이고 있어도 같은 서버의 알림이면 그 화면을 연다.
      if (this.serverUrl === url || (this.serverUrl === undefined && this.diffUrl === url)) {
        this.openServer(url, attentionPath(event));
      }
    });
    notification.show();
  }

  private notifyVersion(server: string): void {
    if (this.notifiedVersion || !Notification.isSupported()) return;
    this.notifiedVersion = true;
    new Notification({
      title: t("notifications.versionDiffers.title"),
      body: t("notifications.versionDiffers.body", { server, app: this.options.serverVersion }),
    }).show();
  }

  // ── 트레이·메뉴 막대 ──────────────────────────────────────

  private refreshMenus(): void {
    const items = this.menuItems();
    this.tray?.setContextMenu(Menu.buildFromTemplate(items));
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { type: "separator" },
            {
              id: "quit",
              label: t("tray.quit"),
              accelerator: "CommandOrControl+Q",
              click: () => this.quit(),
            },
          ],
        },
        { label: t("menu.edit"), role: "editMenu" },
        { label: t("menu.view"), role: "viewMenu" },
        { label: t("menu.server"), submenu: items },
        { label: t("menu.window"), role: "windowMenu" },
      ]),
    );
  }

  /** 트레이와 메뉴 막대 "서버" 가 같은 항목을 쓴다. id 는 패키징한 앱 시험이 누른다 */
  private menuItems(): MenuItemConstructorOptions[] {
    const items: MenuItemConstructorOptions[] = [
      { id: "status", label: this.statusLabel(), enabled: false },
    ];
    const versionLine = this.versionLine();
    if (versionLine !== undefined) items.push({ label: versionLine, enabled: false });
    items.push(
      { type: "separator" },
      { id: "open", label: t("tray.open"), click: () => this.showWindow() },
    );

    // ③(external)에 붙었으면 켜고 끄기를 하지 않는다(Q2, 서비스 관리자가 띄운다).
    const state = this.watch.state;
    const owned = this.mode === "local" && !("owner" in state && state.owner === "external");
    if (owned) {
      const running = state.kind === "running" || state.kind === "starting";
      items.push(
        running
          ? { id: "server-stop", label: t("tray.stopServer"), click: () => void this.stopLocal() }
          : {
              id: "server-start",
              label: t("tray.startServer"),
              click: () => void this.restartLocal(),
            },
      );
    }
    if (this.mode === "local") {
      const openAtLogin = this.options.settings.read().openAtLogin ?? true;
      items.push({
        id: "open-at-login",
        label: t("tray.openAtLogin"),
        type: "checkbox",
        checked: openAtLogin,
        click: (item) => {
          this.options.settings.write({
            ...this.options.settings.read(),
            openAtLogin: item.checked,
          });
          this.applyLoginItem(item.checked);
        },
      });
    }
    if (this.mode === "remote") {
      items.push({
        id: "choose-server",
        label: t("tray.chooseServer"),
        click: () => {
          this.showWindow();
          void this.chooseRemote();
        },
      });
    }
    items.push(
      {
        id: "change-mode",
        label: t("tray.changeMode"),
        click: () => {
          this.showWindow();
          this.chooseMode();
        },
      },
      { type: "separator" },
      { id: "quit-app", label: t("tray.quit"), click: () => this.quit() },
    );
    if (owned) {
      items.push({
        id: "quit-with-server",
        label: t("tray.quitWithServer"),
        click: () => void this.quitWithServer(),
      });
    }
    return items;
  }

  private statusLabel(): string {
    if (this.mode === "choosing") return t("tray.status.choosing");
    if (this.mode === "remote") {
      const name = this.remote?.server.name ?? "";
      return this.remote?.reachable === true
        ? t("tray.status.remote", { name })
        : t("tray.status.remoteUnreachable", { name });
    }
    const state = this.watch.state;
    switch (state.kind) {
      case "running":
        return state.owner === "external" ? t("tray.status.external") : t("tray.status.running");
      case "starting":
        return t("tray.status.starting");
      case "stopped":
        return state.owner === "external"
          ? t("tray.status.externalStopped")
          : t("tray.status.stopped");
      case "failed":
        return t("tray.status.failed");
    }
  }

  private versionLine(): string | undefined {
    const state = this.watch.state;
    if (this.mode !== "local" || state.kind !== "running" || state.owner !== "external")
      return undefined;
    const server = state.status.identity.version;
    if (server === this.options.serverVersion) return undefined;
    return t("tray.versionDiffers", { server, app: this.options.serverVersion });
  }
}

export function notificationText(event: AttentionEvent): { title: string; body: string } {
  switch (event.kind) {
    case "question":
      return {
        title: t("notifications.question.title"),
        body: t("notifications.question.body", { ticket: event.ticketKey }),
      };
    case "permission":
      return {
        title: t("notifications.permission.title"),
        body: t("notifications.permission.body", { ticket: event.ticketKey }),
      };
    case "human-check":
      return {
        title: t("notifications.humanCheck.title"),
        body: t("notifications.humanCheck.body", { ticket: event.ticketKey }),
      };
    case "runner-offline":
      return {
        title: t("notifications.runnerOffline.title"),
        body: t("notifications.runnerOffline.body", { runner: event.runnerName }),
      };
  }
}

export function appPaths(base: string): {
  rendererFile: string;
  preloadFile: string;
  trayIcon: string;
} {
  return {
    rendererFile: join(base, "dist", "renderer", "index.html"),
    preloadFile: join(base, "dist", "preload", "preload.cjs"),
    trayIcon: join(base, "assets", "trayTemplate.png"),
  };
}

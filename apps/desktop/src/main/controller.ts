import { PRODUCT_DISPLAY_NAME } from "@ganger/cli/home";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  ipcMain,
  nativeImage,
  powerMonitor,
  shell,
} from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent, MenuItemConstructorOptions } from "electron";
import { createTranslator } from "use-intl";
import system from "../../messages/ko/system.json" with { type: "json" };
import { NotificationFeed } from "../core/notification-feed.js";
import {
  notificationId,
  openEventIdOf,
  serverKey,
  staleNotificationIds,
} from "../core/notification-ids.js";
import type { FeedBatch } from "../core/notification-feed.js";
import { DEFAULT_NOTIFICATION_PREFS, notificationPrefsSchema } from "../core/notification-prefs.js";
import type { NotificationPrefs } from "../core/notification-prefs.js";
import { notificationText } from "../core/notification-text.js";
import { Notifier } from "../core/notifier.js";
import type { NotifierEffect } from "../core/notifier.js";
import { DEFAULT_SERVER_PORT, discoverServers } from "../core/discovery.js";
import { opensOutsideApp } from "../core/external-url.js";
import type { DiscoveryResult, FoundServer } from "../core/discovery.js";
import { probeIdentity } from "../core/identity.js";
import type { EnsureResult, LocalServer } from "../core/local-server.js";
import { openLog } from "../core/open-log.js";
import { connectAddress, reopenSaved, savedFromFound } from "../core/remote.js";
import type { SavedServer } from "../core/remote.js";
import type { SettingsStore } from "../core/settings.js";
import { ServerWatch } from "../core/watch.js";
import type { WatchState } from "../core/watch.js";
import type {
  FindResult,
  NotificationPermission,
  NotificationSettingsView,
  ViewState,
} from "../shared/view.js";
import {
  IPC_PREFIX,
  NAVIGATE_CHANNEL,
  NOTIFICATION_SETTINGS_CHANNEL,
  NOTIFICATION_SETTINGS_WINDOW,
  VIEW_CHANNEL,
} from "../shared/view.js";
import type { NavScreen } from "@ganger/app/shell/nav-shortcuts";
import { navigationMenu } from "./navigation-menu.js";

const t = createTranslator({ locale: "ko", messages: { system }, namespace: "system" });

const REMINDER_TICK_MS = 30_000;
const REMOTE_RETRY_MS = 5_000;
const SYSTEM_NOTIFICATION_SETTINGS =
  "x-apple.systempreferences:com.apple.Notifications-Settings.extension";

export interface ControllerOptions {
  settings: SettingsStore;
  local: LocalServer;
  serverVersion: string;
  logFile: string;
  rendererFile: string;
  preloadFile: string;
  trayIcon: string;
  openedAtLogin: boolean;
}

type Mode = "choosing" | "local" | "remote";

export class Controller {
  private readonly options: ControllerOptions;
  private window: BrowserWindow | undefined;
  private tray: Tray | undefined;
  private view: ViewState = { screen: "choose-mode" };
  private mode: Mode = "choosing";
  private serverUrl: string | undefined;
  private readonly watch: ServerWatch;
  private feed: { url: string; feed: NotificationFeed; notifier: Notifier } | undefined;
  private catchUp = true;
  private readonly delivered = new Map<string, Notification>();
  private reminderTimer: NodeJS.Timeout | undefined;
  private notificationPermission: NotificationPermission = "unknown";
  private settingsWindow: BrowserWindow | undefined;
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
    this.reminderTimer = setInterval(() => this.tickReminders(), REMINDER_TICK_MS);
    powerMonitor.on("resume", () => {
      this.catchUp = true;
      this.feed?.feed.reconnect();
    });
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

  async quitWithServer(): Promise<void> {
    this.watch.stop();
    this.watch.setWanted(false);
    if (this.mode === "local") await this.options.local.stop();
    this.quit();
  }

  quit(): void {
    this.quitting = true;
    this.watch.stop();
    if (this.reminderTimer !== undefined) clearInterval(this.reminderTimer);
    this.feed?.feed.stop();
    this.stopRemoteRetry();
    app.quit();
  }

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
    this.setView({ screen: "unreachable", name: saved.name, url: saved.url, checking: true });
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
    this.setView({ screen: "unreachable", name: saved.name, url: saved.url, checking: false });
    this.refreshMenus();
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

  private chooseMode(): void {
    this.stopFeed();
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
    if (!app.isPackaged) return;
    app.setLoginItemSettings({ openAtLogin });
  }

  private setView(view: ViewState): void {
    this.view = view;
    const window = this.window;
    if (window === undefined || window.isDestroyed()) return;
    if (this.serverUrl !== undefined) {
      this.serverUrl = undefined;
      this.refreshMenus();
      void window.loadFile(this.options.rendererFile);
      return;
    }
    window.webContents.send(VIEW_CHANNEL, view);
  }

  private openServer(url: string, path = "/"): void {
    if (this.feed?.url !== url) this.startFeed(url);
    this.serverUrl = url;
    this.refreshMenus();
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
      title: PRODUCT_DISPLAY_NAME,
      webPreferences: {
        preload: this.options.preloadFile,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    window.once("ready-to-show", () => window.show());
    window.on("close", (event) => {
      if (this.quitting) return;
      event.preventDefault();
      window.hide();
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (opensOutsideApp(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (this.isAppScreen(url)) return;
      if (this.serverUrl !== undefined && new URL(url).origin === new URL(this.serverUrl).origin)
        return;
      event.preventDefault();
      if (opensOutsideApp(url)) void shell.openExternal(url);
    });
    window.webContents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
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
    handle("open-log", () => this.openLog());
    ipcMain.handle(`${IPC_PREFIX}get-notification-settings`, (event) =>
      fromAppScreen(event) ? this.notificationSettingsView() : undefined,
    );
    handle("set-notification-settings", (value) => {
      const parsed = notificationPrefsSchema.safeParse(value);
      if (parsed.success) this.saveNotificationPrefs(parsed.data);
    });
    handle("open-system-notification-settings", () =>
      process.platform === "darwin" ? shell.openExternal(SYSTEM_NOTIFICATION_SETTINGS) : undefined,
    );
  }

  private openLog(): Promise<void> {
    return openLog(this.options.logFile, {
      exists: existsSync,
      openPath: (path) => shell.openPath(path),
      showItemInFolder: (path) => shell.showItemInFolder(path),
    });
  }

  private notificationPrefs(): NotificationPrefs {
    return this.options.settings.read().notifications ?? DEFAULT_NOTIFICATION_PREFS;
  }

  private startFeed(url: string): void {
    this.stopFeed();
    const notifier = new Notifier({
      prefs: () => this.notificationPrefs(),
      lastSeen: this.options.settings.read().notificationsSeen?.[url] ?? null,
    });
    const feed = new NotificationFeed({
      origin: url,
      onBatch: (batch) => this.receiveNotifications(url, batch),
    });
    this.feed = { url, feed, notifier };
    feed.start();
  }

  private stopFeed(): void {
    const current = this.feed;
    if (current === undefined) return;
    this.feed = undefined;
    current.feed.stop();
    this.applyNotifications(current.url, current.notifier.clear());
  }

  private receiveNotifications(url: string, batch: FeedBatch): void {
    const current = this.feed;
    if (current?.url !== url) return;
    const mode = batch.initial && this.catchUp ? "catch-up" : "live";
    if (batch.initial) this.catchUp = false;
    this.applyNotifications(url, current.notifier.receive(batch, mode, Date.now()));
    if (batch.initial && batch.open !== null) void this.removeStaleNotifications(url, batch.open);
  }

  private tickReminders(): void {
    const current = this.feed;
    if (current === undefined) return;
    this.applyNotifications(current.url, current.notifier.tick(Date.now()));
  }

  private applyNotifications(url: string, effects: ReadonlyArray<NotifierEffect>): void {
    for (const effect of effects) {
      switch (effect.type) {
        case "show":
          this.showNotification(url, effect);
          break;
        case "remove":
          this.removeNotifications(effect.ids.map((id) => notificationId(url, id)));
          break;
        case "badge":
          app.setBadgeCount(effect.count);
          break;
        case "seen": {
          const settings = this.options.settings.read();
          this.options.settings.write({
            ...settings,
            notificationsSeen: { ...settings.notificationsSeen, [url]: effect.lastId },
          });
          break;
        }
      }
    }
  }

  private showNotification(url: string, effect: Extract<NotifierEffect, { type: "show" }>): void {
    if (!Notification.isSupported()) return;
    const id = notificationId(url, effect.id);
    const { title, body } = notificationText(effect.content);
    this.delivered.get(id)?.close();
    const notification = new Notification({
      id,
      groupId: serverKey(url),
      title,
      body,
      silent: effect.silent,
    });
    notification.on("click", () => {
      this.delivered.delete(id);
      this.showWindow();
      if (this.serverUrl === url || this.feed?.url === url) this.openServer(url, effect.path);
    });
    notification.on("show", () => this.setNotificationPermission("allowed"));
    notification.on("failed", () => this.setNotificationPermission("denied"));
    this.delivered.set(id, notification);
    notification.show();
  }

  private removeNotifications(ids: ReadonlyArray<string>): void {
    for (const id of ids) {
      this.delivered.get(id)?.close();
      this.delivered.delete(id);
    }
    if (process.platform === "darwin" && ids.length > 0) Notification.remove([...ids]);
  }

  private async removeStaleNotifications(url: string, open: ReadonlyArray<number>): Promise<void> {
    if (process.platform !== "darwin") return;
    const history = await Notification.getHistory().catch(() => []);
    const stale = staleNotificationIds(
      url,
      history.map((notification) => notification.id),
      open,
      new Set(this.delivered.keys()),
    );
    if (stale.length > 0) Notification.remove(stale);
    const staleSet = new Set(stale);
    for (const notification of history) {
      const eventId = openEventIdOf(url, notification.id);
      if (eventId === null || staleSet.has(notification.id)) continue;
      if (this.delivered.has(notification.id)) continue;
      notification.on("click", () => {
        const path = this.feed?.url === url ? this.feed.notifier.openPath(eventId) : undefined;
        this.delivered.delete(notification.id);
        this.showWindow();
        if (path !== undefined) this.openServer(url, path);
      });
      this.delivered.set(notification.id, notification);
    }
  }

  private setNotificationPermission(permission: NotificationPermission): void {
    if (this.notificationPermission === permission) return;
    this.notificationPermission = permission;
    this.sendNotificationSettings();
  }

  private notificationSettingsView(): NotificationSettingsView {
    return { ...this.notificationPrefs(), permission: this.notificationPermission };
  }

  private sendNotificationSettings(): void {
    const window = this.settingsWindow;
    if (window === undefined || window.isDestroyed()) return;
    window.webContents.send(NOTIFICATION_SETTINGS_CHANNEL, this.notificationSettingsView());
  }

  private saveNotificationPrefs(prefs: NotificationPrefs): void {
    this.options.settings.write({ ...this.options.settings.read(), notifications: prefs });
    const current = this.feed;
    if (current !== undefined) this.applyNotifications(current.url, current.notifier.refresh());
    this.sendNotificationSettings();
  }

  showNotificationSettings(): void {
    const existing = this.settingsWindow;
    if (existing !== undefined && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return;
    }
    const window = new BrowserWindow({
      width: 560,
      height: 680,
      minWidth: 400,
      minHeight: 480,
      show: false,
      title: t("settingsWindow.title"),
      webPreferences: {
        preload: this.options.preloadFile,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    window.once("ready-to-show", () => window.show());
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("closed", () => {
      if (this.settingsWindow === window) this.settingsWindow = undefined;
    });
    this.settingsWindow = window;
    void window.loadFile(this.options.rendererFile, {
      query: { window: NOTIFICATION_SETTINGS_WINDOW },
    });
  }

  private notifyVersion(server: string): void {
    if (this.notifiedVersion || !Notification.isSupported()) return;
    this.notifiedVersion = true;
    new Notification({
      title: t("notifications.versionDiffers.title"),
      body: t("notifications.versionDiffers.body", { server, app: this.options.serverVersion }),
    }).show();
  }

  private refreshMenus(): void {
    const items = this.menuItems();
    this.tray?.setContextMenu(Menu.buildFromTemplate(items));
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: "about" },
            {
              id: "notification-settings",
              label: t("menu.notificationSettings"),
              click: () => this.showNotificationSettings(),
            },
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
        navigationMenu({
          label: t("menu.navigate"),
          screenLabel: (screen) => t(`navigate.${screen}`),
          enabled: this.serverUrl !== undefined,
          onNavigate: (screen) => this.navigateTo(screen),
        }),
        { label: t("menu.server"), submenu: items },
        { label: t("menu.window"), role: "windowMenu" },
      ]),
    );
  }

  private navigateTo(screen: NavScreen): void {
    const window = this.window;
    if (this.serverUrl === undefined || window === undefined || window.isDestroyed()) return;
    this.showWindow();
    window.webContents.send(NAVIGATE_CHANNEL, screen);
  }

  private menuItems(): MenuItemConstructorOptions[] {
    const items: MenuItemConstructorOptions[] = [
      { id: "status", label: this.statusLabel(), enabled: false },
    ];
    const versionLine = this.versionLine();
    if (versionLine !== undefined) items.push({ label: versionLine, enabled: false });
    items.push(
      { type: "separator" },
      { id: "open", label: t("tray.open"), click: () => this.showWindow() },
      {
        id: "tray-notification-settings",
        label: t("menu.notificationSettings"),
        click: () => this.showNotificationSettings(),
      },
    );

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

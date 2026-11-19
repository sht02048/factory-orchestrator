import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import {
  DESKTOP_NAVIGATION_GLOBAL,
  isNavScreen,
  navPathKeepingWorkspace,
} from "@ganger/app/shell/nav-shortcuts";
import type { NavScreen } from "@ganger/app/shell/nav-shortcuts";
import type { DesktopApi, ViewState } from "../shared/view.js";
import { IPC_PREFIX, NAVIGATE_CHANNEL, VIEW_CHANNEL } from "../shared/view.js";

if (window.location.protocol === "file:") {
  const invoke = (action: string, ...args: unknown[]): Promise<void> =>
    ipcRenderer.invoke(`${IPC_PREFIX}${action}`, ...args).then(() => undefined);

  const api: DesktopApi = {
    getView: () =>
      new Promise<ViewState>((resolve) => {
        ipcRenderer.once(VIEW_CHANNEL, (_event: IpcRendererEvent, view: ViewState) =>
          resolve(view),
        );
        ipcRenderer.send(`${IPC_PREFIX}request-view`);
      }),
    onView: (listener) => {
      const handler = (_event: IpcRendererEvent, view: ViewState) => listener(view);
      ipcRenderer.on(VIEW_CHANNEL, handler);
      return () => ipcRenderer.off(VIEW_CHANNEL, handler);
    },
    chooseLocal: (options) => invoke("choose-local", options),
    chooseRemote: () => invoke("choose-remote"),
    findServers: (port) => invoke("find-servers", port),
    connectFound: (instanceId) => invoke("connect-found", instanceId),
    showAddress: () => invoke("show-address"),
    connectAddress: (address) => invoke("connect-address", address),
    startLocal: () => invoke("start-local"),
    retry: () => invoke("retry"),
    chooseMode: () => invoke("choose-mode"),
    openLog: () => invoke("open-log"),
  };
  contextBridge.exposeInMainWorld("desktop", api);
}

if (window.location.protocol === "http:" || window.location.protocol === "https:") {
  const listeners = new Set<(screen: NavScreen) => void>();
  ipcRenderer.on(NAVIGATE_CHANNEL, (_event: IpcRendererEvent, screen: unknown) => {
    if (!isNavScreen(screen)) return;
    if (listeners.size === 0) {
      window.location.assign(navPathKeepingWorkspace(screen, window.location.search));
      return;
    }
    for (const listener of listeners) listener(screen);
  });
  contextBridge.exposeInMainWorld(DESKTOP_NAVIGATION_GLOBAL, {
    onNavigate: (listener: (screen: NavScreen) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
}

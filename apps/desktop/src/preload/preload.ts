import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { DesktopApi, ViewState } from "../shared/view.js";
import { IPC_PREFIX, VIEW_CHANNEL } from "../shared/view.js";

/*
 * 앱이 직접 그리는 화면에만 행동을 연다. 같은 창이 서버의 web 화면(원격 서버일 수 있다)도 여는데, 그 화면에는
 * 아무것도 열지 않는다. main 도 보낸 쪽이 앱 화면인지 다시 확인한다.
 */
if (window.location.protocol === "file:") {
  const invoke = (action: string, ...args: unknown[]): Promise<void> =>
    ipcRenderer.invoke(`${IPC_PREFIX}${action}`, ...args).then(() => undefined);

  const api: DesktopApi = {
    // 지금 상태는 VIEW_CHANNEL 로 다시 받는다. invoke 의 돌려받는 값은 타입이 없어 쓰지 않는다.
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
  };
  contextBridge.exposeInMainWorld("desktop", api);
}

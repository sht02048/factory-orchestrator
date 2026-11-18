/*
 * 앱이 직접 그리는 화면(첫 실행 모드 선택, 서버 찾기, 주소 입력, 닿지 않음, 로컬 서버 상태)의 상태와 화면이 부르는
 * 행동. main 이 상태를 정하고 renderer 는 그리기만 한다. preload 가 둘 사이를 잇는다.
 */

export type ConnectError = "invalid" | "unreachable" | "not-ours" | "host-not-allowed";

export interface FoundServerView {
  instanceId: string;
  name: string;
  url: string;
  version: string;
  versionDiffers: boolean;
  webAccess: "allowed" | "host-not-allowed";
}

export type FindResult =
  | { kind: "missing" | "stopped" | "unreadable" }
  | { kind: "found"; servers: FoundServerView[] };

export type ViewState =
  | { screen: "choose-mode" }
  | { screen: "local-starting" }
  | { screen: "local-stopped" }
  | { screen: "local-failed"; logFile: string }
  | { screen: "local-service" }
  | { screen: "find-servers"; port: number; searching: boolean; result: FindResult | null }
  | { screen: "enter-address"; checking: boolean; error: ConnectError | null }
  | { screen: "unreachable"; name: string; checking: boolean };

export interface DesktopApi {
  getView(): Promise<ViewState>;
  onView(listener: (view: ViewState) => void): () => void;
  chooseLocal(options: { openAtLogin: boolean }): Promise<void>;
  chooseRemote(): Promise<void>;
  findServers(port: number): Promise<void>;
  connectFound(instanceId: string): Promise<void>;
  showAddress(): Promise<void>;
  connectAddress(address: string): Promise<void>;
  startLocal(): Promise<void>;
  retry(): Promise<void>;
  chooseMode(): Promise<void>;
}

/** ipc 채널 이름. 행동 이름 앞에 붙인다 */
export const IPC_PREFIX = "desktop:";
export const VIEW_CHANNEL = "desktop:view";

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
  | { screen: "unreachable"; name: string; url: string; checking: boolean };

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
  openLog(): Promise<void>;
}

export const IPC_PREFIX = "desktop:";
export const VIEW_CHANNEL = "desktop:view";
export const NAVIGATE_CHANNEL = "desktop:navigate";

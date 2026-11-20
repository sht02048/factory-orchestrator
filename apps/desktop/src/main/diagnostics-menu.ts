import { DIAGNOSTICS_PATH } from "@ganger/app/diagnostics/model";
import type { MenuItemConstructorOptions } from "electron";

export function diagnosticsUrl(serverUrl: string): string {
  return new URL(DIAGNOSTICS_PATH, serverUrl).toString();
}

export function diagnosticsMenuItem(options: {
  label: string;
  serverUrl: string | undefined;
  download: (url: string) => void;
}): MenuItemConstructorOptions {
  const { serverUrl } = options;
  return {
    id: "make-diagnostics",
    label: options.label,
    enabled: serverUrl !== undefined,
    click: () => {
      if (serverUrl !== undefined) options.download(diagnosticsUrl(serverUrl));
    },
  };
}

export function logFolderOpenable(mode: "choosing" | "local" | "remote"): boolean {
  return mode === "local";
}

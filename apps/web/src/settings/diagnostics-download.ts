import type { DiagnosticsResult } from "./log-section";

export interface DownloadDeps {
  fetch: (url: string) => Promise<Response>;
  save: (blob: Blob, name: string) => void;
}

const FALLBACK_NAME = "ganger-diagnostics.zip";

export function attachmentName(disposition: string | null): string {
  const name = /filename="([^"]+)"/.exec(disposition ?? "")?.[1];
  return name === undefined || !/^[\w.-]+\.zip$/.test(name) ? FALLBACK_NAME : name;
}

export async function downloadDiagnostics(
  href: string,
  deps: DownloadDeps,
): Promise<DiagnosticsResult> {
  let response: Response;
  try {
    response = await deps.fetch(href);
  } catch {
    return { ok: false, reason: "network" };
  }
  if (!response.ok) return { ok: false, reason: "unknown" };
  const name = attachmentName(response.headers.get("content-disposition"));
  deps.save(await response.blob(), name);
  return { ok: true, name };
}

export function browserDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { diagnosticsHref } from "@ganger/app/diagnostics/model";
import { MutationRejectedError } from "../query/mutation-error";
import { getLogSettings, saveDebugLogSetting } from "../server/log-functions";
import { useDesktopLogFolder } from "../shell/desktop-logs";
import { browserDownload, downloadDiagnostics } from "./diagnostics-download";
import type { LogActions } from "./log-section";
import type { ActionResult } from "./settings-screen";

export const LOG_SETTINGS_KEY = ["log-settings"] as const;

export const logSettingsQuery = queryOptions({
  queryKey: LOG_SETTINGS_KEY,
  queryFn: () => getLogSettings(),
});

export function useLogActions(): LogActions {
  const queryClient = useQueryClient();
  const openFolder = useDesktopLogFolder();
  const { mutateAsync } = useMutation({
    mutationFn: async (input: { debug: boolean }): Promise<ActionResult> => {
      const result = await saveDebugLogSetting({ data: input });
      if (!result.ok) throw new MutationRejectedError(result.reason);
      return result;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LOG_SETTINGS_KEY }),
  });
  const saveDebug = useCallback(
    (input: { debug: boolean }): Promise<ActionResult> =>
      mutateAsync(input).catch((error: unknown) => {
        if (!(error instanceof MutationRejectedError)) return { ok: false, reason: "unknown" };
        const reason: unknown = error.reason;
        return { ok: false, reason: String(reason) };
      }),
    [mutateAsync],
  );
  return useMemo(
    () => ({
      saveDebug,
      makeDiagnostics: (input) =>
        downloadDiagnostics(diagnosticsHref(input), {
          fetch: (url) => fetch(url, { credentials: "same-origin" }),
          save: browserDownload,
        }),
      openFolder,
    }),
    [saveDebug, openFolder],
  );
}

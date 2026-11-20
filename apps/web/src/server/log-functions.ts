import { createServerFn } from "@tanstack/react-start";
import { browserErrorInput, debugLogInput } from "@ganger/app/diagnostics/model";
import { readLogSettingsView, recordBrowserError, saveDebugLog } from "./log-settings";

export const getLogSettings = createServerFn({ method: "GET" }).handler(() =>
  readLogSettingsView(process.env),
);

export const saveDebugLogSetting = createServerFn({ method: "POST" })
  .validator(debugLogInput)
  .handler(({ data }) => saveDebugLog(process.env, data.debug));

export const reportBrowserError = createServerFn({ method: "POST" })
  .validator(browserErrorInput)
  .handler(({ data }) => {
    recordBrowserError(data, Date.now());
  });

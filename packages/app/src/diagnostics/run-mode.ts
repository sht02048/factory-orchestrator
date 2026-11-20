export type RunMode = "desktop" | "launchd" | "systemd" | "terminal" | "development";

export function runModeOf(
  env: Readonly<Record<string, string | undefined>>,
  serviceName: string,
): RunMode {
  if (env["ELECTRON_RUN_AS_NODE"] === "1") return "desktop";
  if ((env["INVOCATION_ID"] ?? "") !== "") return "systemd";
  if (env["XPC_SERVICE_NAME"] === serviceName) return "launchd";
  if ((env["GANGER_HOME"] ?? "").trim() === "") return "development";
  return "terminal";
}

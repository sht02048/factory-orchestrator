import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE_NAME = "factory-orchestrator";

export function launchdPlistPath(userHome: string): string {
  return join(userHome, "Library", "LaunchAgents", `${SERVICE_NAME}.plist`);
}

export function serviceInstalledFor(home: string, userHome: string): boolean {
  const path = launchdPlistPath(userHome);
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf8").includes(`<string>${escapeXml(home)}</string>`);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

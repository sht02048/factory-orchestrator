import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * 이 home 에 헤드리스 서비스(③, CLI `service install`, apps/cli/src/service.ts)가 등록돼 있는지 본다. 등록돼 있으면
 * 서비스 관리자가 서버를 띄우고 다시 띄우므로 앱은 ②를 띄우지 않고 붙기만 한다. 앱은 macOS 부터라(Q7) launchd 만 본다.
 */

/** CLI 의 SERVICE_NAME 과 같다 */
const SERVICE_NAME = "factory-orchestrator";

export function launchdPlistPath(userHome: string): string {
  return join(userHome, "Library", "LaunchAgents", `${SERVICE_NAME}.plist`);
}

export function serviceInstalledFor(home: string, userHome: string): boolean {
  const path = launchdPlistPath(userHome);
  if (!existsSync(path)) return false;
  // 서비스는 `start --home <home>` 을 돌린다. 다른 home 의 서비스면 이 home 과 상관없다.
  return readFileSync(path, "utf8").includes(`<string>${escapeXml(home)}</string>`);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

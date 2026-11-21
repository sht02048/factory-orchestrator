import { log } from "@ganger/log";
import { getInstallSettings, parseBootConfig } from "@ganger/db";
import type { InstallAddresses } from "@ganger/db";
import { hostBlockedResponse, wantsHostBlockedPage } from "@ganger/app/host-blocked-page";
import {
  allowedHosts,
  checkRequest,
  isFunnelRequest,
  isHostAllowed,
  isWildcardBind,
  rejectionLogFields,
  rejectionResponse,
} from "@ganger/app/request-guard";
import type { AllowedHosts } from "@ganger/app/request-guard";
import { createTailnetHostsCache } from "@ganger/app/tailnet-hosts";
import { createTranslator } from "use-intl";
import hostBlocked from "../../messages/ko/hostBlocked.json" with { type: "json" };
import { getDatabase } from "./database";
import { getThisTailnetAddresses } from "./webhook-reach";

const tailnetHosts = createTailnetHostsCache(getThisTailnetAddresses);

const hostBlockedText = createTranslator({
  locale: "ko",
  messages: { hostBlocked },
  namespace: "hostBlocked",
});

function bindHost(): string | null {
  try {
    return parseBootConfig(process.env).host;
  } catch {
    return null;
  }
}

function webPort(): number | null {
  try {
    return parseBootConfig(process.env).port;
  } catch {
    return null;
  }
}

function addresses(): InstallAddresses {
  try {
    return getInstallSettings(getDatabase());
  } catch {
    return { webAddress: null, webhookAddress: null };
  }
}

function tailnetHostsToAllow(): ReadonlyArray<string> {
  return isWildcardBind(bindHost()) ? tailnetHosts.hosts() : [];
}

export function autoAllowInput(): { tailnetHosts: ReadonlyArray<string>; webPort: number | null } {
  return { tailnetHosts: tailnetHostsToAllow(), webPort: webPort() };
}

export function autoAllowedAddresses(): ReadonlyArray<string> {
  return [...currentAllowedHosts().tailnetWeb];
}

export async function refreshAutoAllowedHosts(): Promise<void> {
  if (isWildcardBind(bindHost())) await tailnetHosts.refresh();
}

export function currentAllowedHosts(): AllowedHosts {
  return allowedHosts({ bindHost: bindHost(), ...addresses(), ...autoAllowInput() });
}

export async function isRequestHostAllowed(request: Request): Promise<boolean> {
  const hostHeader = request.headers.get("host");
  const { pathname } = new URL(request.url);
  const viaFunnel = isFunnelRequest(request.headers);
  if (isHostAllowed(hostHeader, pathname, currentAllowedHosts(), viaFunnel)) return true;
  await refreshAutoAllowedHosts();
  return isHostAllowed(hostHeader, pathname, currentAllowedHosts(), viaFunnel);
}

export async function guardRequest(request: Request): Promise<Response | null> {
  let verdict = checkRequest(request, currentAllowedHosts());
  if (verdict.ok) {
    void refreshAutoAllowedHosts();
    return null;
  }
  await refreshAutoAllowedHosts();
  verdict = checkRequest(request, currentAllowedHosts());
  if (verdict.ok) return null;
  log().warn("request.rejected", rejectionLogFields(request, verdict));
  if (verdict.reason === "host-not-allowed" && wantsHostBlockedPage(request)) {
    return hostBlockedResponse(request, {
      title: (host) =>
        host === null ? hostBlockedText("titleUnknown") : hostBlockedText("title", { host }),
      body: hostBlockedText("body"),
    });
  }
  return rejectionResponse(verdict.reason);
}

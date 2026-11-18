import { getInstallSettings, parseBootConfig } from "@ganger/db";
import type { InstallAddresses } from "@ganger/db";
import { allowedHosts, checkRequest, rejectionLogLine, rejectionResponse } from "./request-guard";
import type { AllowedHosts } from "./request-guard";
import { getDatabase } from "./database";

function bindHost(): string | null {
  try {
    return parseBootConfig(process.env).host;
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

export function currentAllowedHosts(): AllowedHosts {
  return allowedHosts({ bindHost: bindHost(), ...addresses() });
}

export function guardRequest(request: Request): Response | null {
  const verdict = checkRequest(request, currentAllowedHosts());
  if (verdict.ok) return null;
  console.warn(rejectionLogLine(request, verdict));
  return rejectionResponse(verdict.reason);
}

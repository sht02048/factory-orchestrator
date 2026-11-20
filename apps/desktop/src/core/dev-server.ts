import { normalizeAddress } from "./remote.js";
import type { ServerBundle } from "./server-bundle.js";

export const DEV_SERVER_ENV = "GANGER_DESKTOP_DEV_SERVER";

export class DevServerAddressError extends Error {
  constructor(value: string) {
    super(`${DEV_SERVER_ENV} must be an http or https address, got ${JSON.stringify(value)}`);
    this.name = "DevServerAddressError";
  }
}

export function devServerUrl(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const value = env[DEV_SERVER_ENV]?.trim();
  if (value === undefined || value.length === 0) return undefined;
  if (!/^https?:\/\//i.test(value)) throw new DevServerAddressError(value);
  const origin = normalizeAddress(value);
  if (origin === undefined) throw new DevServerAddressError(value);
  return origin;
}

export function bundlelessServer(version: string): ServerBundle {
  return { root: "", cliEntry: "", version, buildId: `${version}+dev-server` };
}

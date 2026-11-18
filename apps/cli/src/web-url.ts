import type { BootConfig } from "@ganger/db";

export function webUrl(config: Pick<BootConfig, "host" | "port">): string {
  let host = config.host;
  if (host === "0.0.0.0") host = "127.0.0.1";
  else if (host === "::") host = "::1";
  if (host.includes(":")) host = `[${host}]`;
  return `http://${host}:${config.port}`;
}

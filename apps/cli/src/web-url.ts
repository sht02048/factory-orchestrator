import type { BootConfig } from "@factory/db";

/** 바인딩 주소로 닿는 주소. 모든 인터페이스에 바인딩했으면 같은 머신의 루프백으로 닿는다 */
export function webUrl(config: Pick<BootConfig, "host" | "port">): string {
  let host = config.host;
  if (host === "0.0.0.0") host = "127.0.0.1";
  else if (host === "::") host = "::1";
  if (host.includes(":")) host = `[${host}]`;
  return `http://${host}:${config.port}`;
}

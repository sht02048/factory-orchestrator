import { readThisTailnetDevice } from "@ganger/app/tailscale";
import type { ThisTailnetDevice } from "@ganger/app/tailscale";
import type { PingFetch } from "@ganger/app/webhook-address";

export function getThisTailnetDevice(): Promise<ThisTailnetDevice | null> {
  return readThisTailnetDevice();
}

export function getWebhookPingFetch(): PingFetch {
  return (url, init) => fetch(url, init);
}

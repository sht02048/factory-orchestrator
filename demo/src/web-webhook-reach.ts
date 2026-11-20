import type { ThisTailnetDevice } from "@ganger/app/tailscale";
import type { PingFetch } from "@ganger/app/webhook-address";
import { WEBHOOK_PING_PRODUCT } from "@ganger/app/webhook-address";
import { DEMO_TAILNET_HOST } from "./values.ts";

export function getThisTailnetDevice(): Promise<ThisTailnetDevice | null> {
  return Promise.resolve({ cli: "tailscale", host: DEMO_TAILNET_HOST });
}

function nodeError(code: string): TypeError {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
}

export function getWebhookPingFetch(): PingFetch {
  return (url) => {
    const { hostname } = new URL(url);
    const label = hostname.split(".")[0] ?? "";
    if (label === "missing") return Promise.reject(nodeError("ENOTFOUND"));
    if (label === "closed") return Promise.reject(nodeError("ECONNREFUSED"));
    if (label === "broken") return Promise.reject(nodeError("CERT_HAS_EXPIRED"));
    if (label === "other") return Promise.resolve(new Response("<html></html>", { status: 200 }));
    return Promise.resolve(Response.json({ product: WEBHOOK_PING_PRODUCT, match: true }));
  };
}

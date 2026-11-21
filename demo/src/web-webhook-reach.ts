import type { ThisTailnetAddresses, ThisTailnetDevice } from "@ganger/app/tailscale";
import type { PingFetch } from "@ganger/app/webhook-address";
import { WEBHOOK_PING_PRODUCT } from "@ganger/app/webhook-address";
import { DEMO_TAILNET_HOST, DEMO_TAILNET_IP } from "./values.ts";

const DEMO_SERVE_FULL = JSON.stringify({
  TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true }, "10000": { TCPForward: "127.0.0.1:22" } },
  Web: {
    [`${DEMO_TAILNET_HOST}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } },
    [`${DEMO_TAILNET_HOST}:8443`]: { Handlers: { "/docs/": { Proxy: "http://127.0.0.1:4000" } } },
  },
  AllowFunnel: { [`${DEMO_TAILNET_HOST}:8443`]: true },
});

export function getThisTailnetDevice(): Promise<ThisTailnetDevice | null> {
  return Promise.resolve({ cli: "tailscale", host: DEMO_TAILNET_HOST });
}

export function getThisTailnetAddresses(): Promise<ThisTailnetAddresses> {
  return Promise.resolve({ kind: "known", hosts: [DEMO_TAILNET_HOST, DEMO_TAILNET_IP] });
}

export function getServeStatusOutput(): Promise<string | undefined> {
  const mode = process.env["GANGER_DEMO_SERVE"];
  if (mode === "full") return Promise.resolve(DEMO_SERVE_FULL);
  if (mode === "broken") return Promise.resolve("not json");
  return Promise.resolve("{}");
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

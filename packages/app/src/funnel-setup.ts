import { z } from "zod";
import { WEBHOOK_PATH_PREFIX, normalizeHostname } from "./request-guard.js";
import type { FunnelPortChoice, FunnelSetupView } from "./settings/model.js";
import { funnelAddress, funnelCommand } from "./webhook-address.js";

export const FUNNEL_PORTS_BY_PREFERENCE = [8443, 10000, 443] as const;

const FUNNEL_PORTS_ASCENDING = [443, 8443, 10000] as const;
const LOCAL_TARGET = "127.0.0.1";
const HOSTS_REACHED_ON_LOOPBACK = new Set(["127.0.0.1", "0.0.0.0", "[::]"]);

const handlerSchema = z.object({
  Proxy: z.string().optional(),
  Path: z.string().optional(),
  Text: z.string().optional(),
});

const serveConfigSchema = z.object({
  TCP: z.record(z.string(), z.object({ TCPForward: z.string().optional() })).nullish(),
  Web: z
    .record(z.string(), z.object({ Handlers: z.record(z.string(), handlerSchema).nullish() }))
    .nullish(),
  AllowFunnel: z.record(z.string(), z.boolean()).nullish(),
});

const serveStatusSchema = serveConfigSchema.extend({
  Foreground: z.record(z.string(), serveConfigSchema).nullish(),
});

type ServeConfig = z.infer<typeof serveConfigSchema>;

export interface ServePortUse {
  uses: string[];
  isPublic: boolean;
  onlyWebhookProxy: string | null;
  proxies: Array<{ path: string; proxy: string }>;
  forwardsTcp: boolean;
}

export type ServePorts = ReadonlyMap<number, ServePortUse>;

function portOfWebKey(key: string): number | null {
  const port = /:(\d{1,5})$/u.exec(key)?.[1];
  return port === undefined ? null : Number(port);
}

function collect(config: ServeConfig, ports: Map<number, ServePortUse>): void {
  const entry = (port: number): ServePortUse => {
    const existing = ports.get(port);
    if (existing !== undefined) return existing;
    const created: ServePortUse = {
      uses: [],
      isPublic: false,
      onlyWebhookProxy: null,
      proxies: [],
      forwardsTcp: false,
    };
    ports.set(port, created);
    return created;
  };
  for (const [key, listener] of Object.entries(config.TCP ?? {})) {
    if (!/^\d{1,5}$/u.test(key)) continue;
    const use = entry(Number(key));
    if (listener.TCPForward !== undefined) {
      use.uses.push(`TCP → ${listener.TCPForward}`);
      use.forwardsTcp = true;
    }
  }
  for (const [key, site] of Object.entries(config.Web ?? {})) {
    const port = portOfWebKey(key);
    if (port === null) continue;
    const use = entry(port);
    for (const [path, handler] of Object.entries(site.Handlers ?? {})) {
      use.uses.push(`${path} → ${handler.Proxy ?? handler.Path ?? "text"}`);
      if (handler.Proxy !== undefined) use.proxies.push({ path, proxy: handler.Proxy });
    }
    const handlers = Object.entries(site.Handlers ?? {});
    const only = handlers.length === 1 ? handlers[0] : undefined;
    use.onlyWebhookProxy =
      only !== undefined && only[0] === WEBHOOK_PATH_PREFIX && use.uses.length === 1
        ? (only[1].Proxy ?? null)
        : null;
  }
  for (const [key, allowed] of Object.entries(config.AllowFunnel ?? {})) {
    const port = portOfWebKey(key);
    if (port !== null && allowed) entry(port).isPublic = true;
  }
}

export function parseServeStatus(output: string | undefined): ServePorts | null {
  if (output === undefined) return null;
  let json: unknown;
  try {
    json = JSON.parse(output);
  } catch {
    return null;
  }
  const parsed = serveStatusSchema.safeParse(json);
  if (!parsed.success) return null;
  const ports = new Map<number, ServePortUse>();
  collect(parsed.data, ports);
  for (const session of Object.values(parsed.data.Foreground ?? {})) collect(session, ports);
  return ports;
}

export function funnelTargetHost(bindHost: string): string {
  const bind = normalizeHostname(bindHost);
  return HOSTS_REACHED_ON_LOOPBACK.has(bind) ? LOCAL_TARGET : bind;
}

function mayReachThisApp({ path, proxy }: { path: string; proxy: string }, webPort: number) {
  if (proxy.startsWith("unix:")) return true;
  const url = URL.parse(/^[a-z][a-z0-9+.-]*:\/\//iu.test(proxy) ? proxy : `http://${proxy}`);
  if (url === null) return true;
  const defaultPort = url.protocol.startsWith("https") ? "443" : "80";
  if ((url.port === "" ? defaultPort : url.port) !== String(webPort)) return false;
  return !(path.startsWith(WEBHOOK_PATH_PREFIX) && url.pathname.startsWith(WEBHOOK_PATH_PREFIX));
}

export interface FunnelPlanInput {
  cli: string;
  deviceHost: string;
  deviceAddresses: ReadonlyArray<string>;
  bindHost: string;
  webPort: number;
  serveOutput: string | undefined;
}

export function planFunnel(input: FunnelPlanInput): FunnelSetupView {
  const bind = normalizeHostname(input.bindHost);
  if (bind === input.deviceHost || input.deviceAddresses.includes(bind)) {
    return { kind: "bind-tailnet", bindHost: bind };
  }
  const host = funnelTargetHost(input.bindHost);
  const onPort = (port: number) => ({
    command: funnelCommand(input.cli, input.webPort, { host, funnelPort: port }),
    address: funnelAddress(input.deviceHost, port),
  });
  const ready = (port: number, portState: "free" | "ours" | "unknown"): FunnelSetupView => ({
    kind: "ready",
    port,
    portState,
    ...onPort(port),
  });
  const serve = parseServeStatus(input.serveOutput);
  if (serve === null) return ready(FUNNEL_PORTS_BY_PREFERENCE[0], "unknown");
  const webhookTarget = `http://${host}:${String(input.webPort)}${WEBHOOK_PATH_PREFIX}`;
  const ours = FUNNEL_PORTS_BY_PREFERENCE.find((port) => {
    const use = serve.get(port);
    return use?.uses.length === 1 && use.onlyWebhookProxy === webhookTarget;
  });
  if (ours !== undefined) return ready(ours, "ours");
  const free = FUNNEL_PORTS_BY_PREFERENCE.find((port) => !serve.has(port));
  if (free !== undefined) return ready(free, "free");
  const ports: FunnelPortChoice[] = FUNNEL_PORTS_ASCENDING.map((port) => {
    const use = serve.get(port);
    const usage = { port, uses: use?.uses ?? [], isPublic: use?.isPublic ?? false };
    if (use?.forwardsTcp === true) return { ...usage, unavailable: "tcp-forward" };
    if (use?.proxies.some((proxy) => mayReachThisApp(proxy, input.webPort)) === true) {
      return { ...usage, unavailable: "serves-this-app" };
    }
    return { ...usage, unavailable: null, ...onPort(port) };
  });
  return { kind: "ports-full", ports };
}

export function funnelPrefillAddress(funnel: FunnelSetupView | null): string | null {
  return funnel?.kind === "ready" ? funnel.address : null;
}

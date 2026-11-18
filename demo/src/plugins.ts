import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { devPage } from "./dev-page.ts";

const webAdapters = fileURLToPath(
  new URL("../../apps/web/src/server/adapters.ts", import.meta.url),
);
const demoAdapters = fileURLToPath(new URL("./web-adapters.ts", import.meta.url));
const webRouter = fileURLToPath(new URL("../../apps/web/src/router.tsx", import.meta.url));
const prefill = fileURLToPath(new URL("./client/prefill.ts", import.meta.url));

export function swapWebAdapters(): Plugin {
  return {
    name: "ganger-dev-adapters",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (importer === undefined || !source.endsWith("/adapters")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved?.id === webAdapters ? demoAdapters : null;
    },
  };
}

export function injectDevTools(): Plugin {
  return {
    name: "ganger-dev-tools",
    transform(code, id) {
      if (id !== webRouter || this.environment.name !== "client") return null;
      return { code: `${code}\nimport ${JSON.stringify(`/@fs${prefill}`)};\n`, map: null };
    },
  };
}

export function devPageRoutes(): Plugin {
  return {
    name: "ganger-dev-page",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== "/__dev" && !url.pathname.startsWith("/__dev/")) {
          next();
          return;
        }
        handle(req, res, url.pathname);
      });
    },
  };
}

function handle(req: IncomingMessage, res: ServerResponse, path: string): void {
  const life = globalThis.__gangerDev?.runtime?.life;
  if (req.method === "GET" && path === "/__dev") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(devPage(life?.enabled ?? false));
    return;
  }
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${req.headers.host ?? ""}`) {
    res.statusCode = 403;
    res.end();
    return;
  }
  if (req.method !== "POST" || life === undefined) {
    res.statusCode = 404;
    res.end();
    return;
  }
  let result: unknown;
  switch (path) {
    case "/__dev/label":
      result = { ticket: life.labelTicket() };
      break;
    case "/__dev/ticket":
      result = { ticket: life.addTicket()?.key ?? null };
      break;
    case "/__dev/question":
      result = { run: life.askQuestion() };
      break;
    case "/__dev/push-auth":
      result = { healthy: life.togglePushAuth() };
      break;
    case "/__dev/life":
      life.enabled = !life.enabled;
      result = { enabled: life.enabled };
      break;
    default:
      res.statusCode = 404;
      res.end();
      return;
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(result));
}

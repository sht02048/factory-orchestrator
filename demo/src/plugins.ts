import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { devPage } from "./dev-page.ts";

/*
 * 개발 진입점(main.ts)이 web 개발 서버에 더하는 vite 플러그인(티켓 0047). 제품의 vite 설정(apps/web/vite.config.ts)과
 * 빌드에는 들어가지 않는다. 그래서 가짜 어댑터·가짜 값 채우기·개발 화면은 프로덕션 빌드에 실리지 않는다.
 */

const webAdapters = fileURLToPath(
  new URL("../../apps/web/src/server/adapters.ts", import.meta.url),
);
const demoAdapters = fileURLToPath(new URL("./web-adapters.ts", import.meta.url));
const webRouter = fileURLToPath(new URL("../../apps/web/src/router.tsx", import.meta.url));
const prefill = fileURLToPath(new URL("./client/prefill.ts", import.meta.url));

/** web 의 server/adapters.ts 를 가짜 세계의 등록표로 바꾼다(e2e 브라우저 시험과 같은 방식) */
export function swapWebAdapters(): Plugin {
  return {
    name: "factory-dev-adapters",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (importer === undefined || !source.endsWith("/adapters")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved?.id === webAdapters ? demoAdapters : null;
    },
  };
}

/** 브라우저 쪽 router 모듈 끝에 개발 도구(가짜 값 채우기, 개발 화면 링크)를 붙인다 */
export function injectDevTools(): Plugin {
  return {
    name: "factory-dev-tools",
    transform(code, id) {
      if (id !== webRouter || this.environment.name !== "client") return null;
      return { code: `${code}\nimport ${JSON.stringify(`/@fs${prefill}`)};\n`, map: null };
    },
  };
}

/** 개발 화면 /__dev 와 그 동작(POST /__dev/<동작>) */
export function devPageRoutes(): Plugin {
  return {
    name: "factory-dev-page",
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
  const life = globalThis.__factoryDev?.runtime?.life;
  if (req.method === "GET" && path === "/__dev") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(devPage(life?.enabled ?? false));
    return;
  }
  // 다른 사이트가 브라우저로 보낸 POST 는 받지 않는다. 브라우저는 POST 에 Origin 을 붙인다.
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

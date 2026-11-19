import { navShortcutOf, navShortcuts } from "@ganger/app/shell/nav-shortcuts";
import type { NavScreen } from "@ganger/app/shell/nav-shortcuts";
import type { Page, Request } from "playwright-core";
import shell from "../../apps/web/messages/ko/shell.json" with { type: "json" };

export interface ServerCall {
  name: string;
  ms: number;
}

export interface NavigationSample {
  screen: NavScreen;
  ms: number;
  serverCalls: ServerCall[];
}

export type NavigationRound = "first" | "again" | "hover";

const SERVER_FN_PATH = "/_serverFn/";
const HOVER_MS = 300;

export function serverFnName(url: string): string {
  const id = new URL(url).pathname.slice(SERVER_FN_PATH.length);
  try {
    const decoded = Buffer.from(id, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed === "object" && parsed !== null && "export" in parsed) {
      const name = parsed.export;
      if (typeof name === "string") return name.replace(/_createServerFn_handler$/, "");
    }
  } catch {
    return id.slice(0, 12);
  }
  return id.slice(0, 12);
}

function railLink(page: Page, screen: NavScreen) {
  return page
    .getByRole("navigation", { name: shell.nav.label })
    .getByRole("link", { name: new RegExp(`^${shell.nav[screen]}(,|$)`) });
}

export async function waitForRouterIdle(page: Page, pathname: string): Promise<void> {
  await page.waitForFunction(
    (path) => {
      const state: unknown = Reflect.get(Reflect.get(window, "__TSR_ROUTER__") ?? {}, "state");
      if (typeof state !== "object" || state === null) return false;
      const resolved: unknown = Reflect.get(state, "resolvedLocation");
      const matches: unknown = Reflect.get(state, "matches");
      if (typeof resolved !== "object" || resolved === null || !Array.isArray(matches))
        return false;
      const leaf: unknown = matches.at(-1);
      return (
        Reflect.get(resolved, "pathname") === path &&
        typeof leaf === "object" &&
        leaf !== null &&
        Reflect.get(leaf, "status") === "success" &&
        Reflect.get(state, "status") === "idle"
      );
    },
    pathname,
    { polling: "raf" },
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

export async function waitForScreen(page: Page, screen: NavScreen): Promise<void> {
  await railLink(page, screen).and(page.locator('[aria-current="page"]')).waitFor();
  await waitForRouterIdle(page, navShortcutOf(screen).path);
}

export async function navigateByRail(
  page: Page,
  screen: NavScreen,
  round: NavigationRound,
): Promise<NavigationSample> {
  const link = railLink(page, screen);
  const calls: Promise<ServerCall>[] = [];
  const onRequest = (request: Request) => {
    if (!request.url().includes(SERVER_FN_PATH)) return;
    const started = Date.now();
    calls.push(
      request.response().then(async (response) => {
        await response?.finished();
        return { name: serverFnName(request.url()), ms: Date.now() - started };
      }),
    );
  };
  if (round === "hover") {
    await link.hover();
    await page.waitForTimeout(HOVER_MS);
  }
  page.on("request", onRequest);
  const started = Date.now();
  await link.click();
  await waitForScreen(page, screen);
  const ms = Date.now() - started;
  page.off("request", onRequest);
  return { screen, ms, serverCalls: await Promise.all(calls) };
}

export const railOrder: ReadonlyArray<NavScreen> = navShortcuts.map((item) => item.screen);

export async function measureRail(
  page: Page,
  round: NavigationRound,
  order: ReadonlyArray<NavScreen> = railOrder,
): Promise<NavigationSample[]> {
  const samples: NavigationSample[] = [];
  for (const screen of order) samples.push(await navigateByRail(page, screen, round));
  return samples;
}

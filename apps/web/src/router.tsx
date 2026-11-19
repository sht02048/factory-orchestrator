import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const PRELOAD_FRESH_MS = 5_000;

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: PRELOAD_FRESH_MS,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}

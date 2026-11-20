import type { Page } from "playwright-core";

export async function waitForScreenQuerySettled(
  page: Page,
  queryKey: ReadonlyArray<string>,
): Promise<void> {
  await page.waitForFunction(
    (key) => {
      const field = (owner: unknown, name: string): unknown =>
        typeof owner === "object" && owner !== null ? Reflect.get(owner, name) : undefined;
      const call = (owner: unknown, name: string, args: unknown[] = []): unknown => {
        const method = field(owner, name);
        return typeof method === "function" ? Reflect.apply(method, owner, args) : undefined;
      };
      const router: unknown = Reflect.get(window, "__TSR_ROUTER__");
      const client = field(field(field(router, "options"), "context"), "queryClient");
      const queries = call(call(client, "getQueryCache"), "findAll", [{ queryKey: key }]);
      const mounted =
        Array.isArray(queries) &&
        queries.some((query: unknown) => {
          const observers = field(query, "observers");
          return Array.isArray(observers) && observers.length > 0;
        });
      return mounted && call(client, "isFetching") === 0 && call(client, "isMutating") === 0;
    },
    queryKey,
    { polling: 50 },
  );
}

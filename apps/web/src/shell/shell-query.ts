import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import type { ShellData } from "@ganger/app/shell/model";
import { getShell } from "../server/functions";

export const SHELL_KEY = ["shell"] as const;

export const shellQuery = queryOptions({
  queryKey: SHELL_KEY,
  queryFn: ({ signal }) => getShell({ signal }),
});

export function useShell(): ShellData {
  return useSuspenseQuery(shellQuery).data;
}

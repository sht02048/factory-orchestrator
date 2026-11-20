import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

export function useTitleFollowsQuery(
  routeId: string,
  titleName: string | null,
  queryName: string | null,
): void {
  const router = useRouter();
  useEffect(() => {
    if (titleName === queryName) return;
    void router.invalidate({ filter: (match) => match.routeId === routeId });
  }, [router, routeId, titleName, queryName]);
}

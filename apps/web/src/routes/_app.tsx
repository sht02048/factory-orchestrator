import {
  Outlet,
  createFileRoute,
  retainSearchParams,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { z } from "zod";
import { getShell } from "../server/functions";
import { AppShell } from "../shell/app-shell";
import { resolveWorkspace } from "../shell/model";

/*
 * 사이드바가 있는 화면의 틀. 현재 Workspace 는 주소의 ws 값이고(없으면 첫 Workspace),
 * 내비로 옮겨 다녀도 ws 를 이어 간다. 러너는 Workspace 밖 자원이라 언제나 모두 보인다(ADR 0006).
 */
export const Route = createFileRoute("/_app")({
  validateSearch: z.object({ ws: z.string().optional() }),
  search: { middlewares: [retainSearchParams(["ws"])] },
  loader: () => getShell(),
  shouldReload: false,
  component: AppLayout,
});

function AppLayout() {
  const shell = Route.useLoaderData();
  const { ws } = Route.useSearch();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  return (
    <AppShell
      shell={shell}
      workspace={resolveWorkspace(shell.workspaces, ws)}
      pathname={pathname}
      onWorkspaceChange={(next) => {
        void navigate({ to: ".", search: { ws: next } });
      }}
    >
      <Outlet />
    </AppShell>
  );
}

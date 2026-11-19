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
import { resolveWorkspace } from "@ganger/app/shell/model";

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

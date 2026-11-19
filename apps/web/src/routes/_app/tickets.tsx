import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { createTranslator } from "use-intl";
import { z } from "zod";
import { ScreenMessages, defaultLocale } from "../../i18n";
import { assignTicket, getTicketsPage } from "../../server/functions";
import { ticketsMessages } from "../../tickets/messages";
import { TICKET_FILTERS } from "@ganger/app/tickets/model";
import { TicketsScreen } from "../../tickets/tickets-screen";

const t = createTranslator({
  locale: defaultLocale,
  messages: ticketsMessages,
  namespace: "tickets",
});
const appRoute = getRouteApi("/_app");

export const Route = createFileRoute("/_app/tickets")({
  validateSearch: z.object({
    f: z.enum(TICKET_FILTERS).optional().catch(undefined),
    sel: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({ ws: search.ws }),
  loader: ({ deps }) => getTicketsPage({ data: { ws: deps.ws } }),
  head: () => ({ meta: [{ title: t("documentTitle") }] }),
  component: TicketsRoute,
});

function TicketsRoute() {
  const page = Route.useLoaderData();
  const shell = appRoute.useLoaderData();
  const { f, sel } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  return (
    <ScreenMessages messages={ticketsMessages}>
      <TicketsScreen
        page={page}
        workspaces={shell.workspaces}
        filter={f ?? "all"}
        selectedId={sel}
        onFilterChange={(next) => {
          void navigate({
            search: (prev) => ({ ...prev, f: next === "all" ? undefined : next, sel: undefined }),
            replace: true,
          });
        }}
        onSelect={(id) => {
          void navigate({
            search: (prev) => ({ ...prev, sel: id }),
            replace: true,
            resetScroll: false,
          });
        }}
        onPickWorkspace={(ws) => {
          void navigate({ search: (prev) => ({ ...prev, ws, sel: undefined }) });
        }}
        onOpenRun={(runId) => {
          void navigate({ to: "/runs", search: (prev) => ({ ws: prev.ws, sel: runId }) });
        }}
        onAssign={(input) => assignTicket({ data: input })}
        onAssigned={(id) => {
          void navigate({
            search: (prev) => ({ ...prev, sel: id }),
            replace: true,
            resetScroll: false,
          }).then(() => router.invalidate());
        }}
      />
    </ScreenMessages>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import type { RunControlOutcome } from "@ganger/app/run-control-view";
import { toRunId } from "@ganger/core";
import type { RunId } from "@ganger/core";
import { ANSWER_REJECT_REASONS, DENY_REJECT_REASONS, rejectedAs } from "../query/mutation-error";
import { answerQuestion, controlRun, denyPermission } from "../server/functions";
import type { AnswerInput, ControlInput, DenyInput } from "./home-screen";

export const ROUTER_ROUTES_SHOWING_RUNS: ReadonlySet<string> = new Set([
  "/_app/runs",
  "/_app/runs_/$runId",
  "/_app/tickets",
  "/_app/runners",
]);

export function keysChangedByRunWrite(runId: RunId): ReadonlyArray<QueryKey> {
  return [["dashboard"], ["runs", "detail", runId], ["runs", "list"]];
}

async function invalidateRunWrite(
  queryClient: QueryClient,
  invalidateRouterRoutes: () => Promise<void>,
  runId: RunId,
): Promise<void> {
  await Promise.all([
    ...keysChangedByRunWrite(runId).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    invalidateRouterRoutes(),
  ]);
}

export interface DashboardActions {
  onAnswer: (input: AnswerInput) => Promise<void>;
  onDeny: (input: DenyInput) => Promise<void>;
  onControl: (input: ControlInput) => Promise<RunControlOutcome>;
}

export function useDashboardActions(): DashboardActions {
  const queryClient = useQueryClient();
  const router = useRouter();
  const afterWrite = (runId: string) =>
    invalidateRunWrite(
      queryClient,
      () => router.invalidate({ filter: (match) => ROUTER_ROUTES_SHOWING_RUNS.has(match.routeId) }),
      toRunId(runId),
    );
  const answer = useMutation({
    mutationFn: (input: AnswerInput) =>
      rejectedAs(() => answerQuestion({ data: input }), ANSWER_REJECT_REASONS),
    onSuccess: (_result, input) => afterWrite(input.runId),
  });
  const deny = useMutation({
    mutationFn: (input: DenyInput) =>
      rejectedAs(() => denyPermission({ data: input }), DENY_REJECT_REASONS),
    onSuccess: (_result, input) => afterWrite(input.runId),
  });
  const control = useMutation({
    mutationFn: async (input: ControlInput): Promise<RunControlOutcome> => {
      const result = await controlRun({ data: input });
      return result.ok ? "requested" : "state-changed";
    },
    onSuccess: (_outcome, input) => afterWrite(input.runId),
  });
  return {
    onAnswer: async (input) => {
      await answer.mutateAsync(input);
    },
    onDeny: async (input) => {
      await deny.mutateAsync(input);
    },
    onControl: (input) => control.mutateAsync(input),
  };
}

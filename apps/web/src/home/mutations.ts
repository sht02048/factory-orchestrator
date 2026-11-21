import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { RunControlOutcome } from "@ganger/app/run-control-view";
import { toRunId } from "@ganger/core";
import type { RunId } from "@ganger/core";
import { ANSWER_REJECT_REASONS, DENY_REJECT_REASONS, rejectedAs } from "../query/mutation-error";
import { withRunActionRequestId } from "../query/run-action-request-ids";
import { keysChangedByRunWrite } from "../runs/queries";
import { answerHumanCheck, answerQuestion, controlRun, denyPermission } from "../server/functions";
import type { AnswerInput, ControlInput, DenyInput, HumanCheckInput } from "./home-screen";

async function invalidateRunWrite(queryClient: QueryClient, runId: RunId): Promise<void> {
  await Promise.all(
    keysChangedByRunWrite(runId).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}

export interface DashboardActions {
  onAnswer: (input: AnswerInput) => Promise<void>;
  onHumanCheck: (input: HumanCheckInput) => Promise<void>;
  onDeny: (input: DenyInput) => Promise<void>;
  onControl: (input: ControlInput) => Promise<RunControlOutcome>;
}

export function useDashboardActions(): DashboardActions {
  const queryClient = useQueryClient();
  const afterWrite = (runId: RunId) => invalidateRunWrite(queryClient, runId);
  const answer = useMutation({
    mutationFn: (input: AnswerInput) =>
      withRunActionRequestId(
        queryClient,
        input.runId,
        `answer:${input.questionId}`,
        input.answer,
        (requestId) =>
          rejectedAs(
            () => answerQuestion({ data: { ...input, requestId } }),
            ANSWER_REJECT_REASONS,
          ),
      ),
    onSuccess: (_result, input) => afterWrite(toRunId(input.runId)),
  });
  const humanCheck = useMutation({
    mutationFn: (input: HumanCheckInput) =>
      withRunActionRequestId(
        queryClient,
        input.runId,
        `human-check:${input.questionId}`,
        `${input.decision}:${input.note}`,
        (requestId) =>
          rejectedAs(
            () => answerHumanCheck({ data: { ...input, requestId } }),
            ANSWER_REJECT_REASONS,
          ),
      ),
    onSuccess: (_result, input) => afterWrite(toRunId(input.runId)),
  });
  const deny = useMutation({
    mutationFn: (input: DenyInput) =>
      rejectedAs(() => denyPermission({ data: input }), DENY_REJECT_REASONS),
    onSuccess: (_result, input) => afterWrite(toRunId(input.runId)),
  });
  const control = useMutation({
    mutationFn: (input: ControlInput): Promise<RunControlOutcome> =>
      withRunActionRequestId(
        queryClient,
        input.runId,
        "control",
        input.control,
        async (requestId) => {
          const result = await controlRun({ data: { ...input, requestId } });
          return result.ok ? "requested" : "state-changed";
        },
      ),
    onSuccess: (_outcome, input) => afterWrite(toRunId(input.runId)),
  });
  return {
    onAnswer: async (input) => {
      await answer.mutateAsync(input);
    },
    onHumanCheck: async (input) => {
      await humanCheck.mutateAsync(input);
    },
    onDeny: async (input) => {
      await deny.mutateAsync(input);
    },
    onControl: (input) => control.mutateAsync(input),
  };
}

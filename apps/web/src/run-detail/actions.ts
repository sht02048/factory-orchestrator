import { mutationOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient, QueryState } from "@tanstack/react-query";
import { useMemo } from "react";
import type { RunControlOutcome } from "@ganger/app/run-control-view";
import type { RunControlActionResult } from "@ganger/app/run-control";
import type { RunActionResult } from "@ganger/app/run-detail/actions";
import type { RunDetailPage } from "@ganger/app/run-detail/model";
import { toRunId } from "@ganger/core";
import type { RunControl, RunId } from "@ganger/core";
import {
  ANSWER_REJECT_REASONS,
  DENY_REJECT_REASONS,
  okOrThrow,
  rejectedAs,
} from "../query/mutation-error";
import { keysChangedByRunWrite, runDetailKey } from "../runs/queries";
import {
  answerQuestion,
  cancelRun,
  controlRun,
  denyPermission,
  removeRunWorktree,
  requestRunLog,
  sendAgentMessage,
} from "../server/functions";
import type { AgentMessageOutcome } from "./agent-message-form";
import type { RunDetailActions } from "./run-detail-screen";

export const RUN_POLL_MS = 2_000;
export const LOG_POLL_LIMIT = 15;

export interface RunDetailCalls {
  answer(input: { runId: string; questionId: string; answer: string }): Promise<unknown>;
  deny(input: { runId: string; promptId: string; reason: string }): Promise<unknown>;
  cancel(runId: string): Promise<RunActionResult>;
  removeWorktree(runId: string): Promise<RunActionResult>;
  control(runId: string, control: RunControl): Promise<RunControlActionResult>;
  sendAgentMessage(runId: RunId, body: string): Promise<RunActionResult>;
  requestLog(runId: string): Promise<boolean>;
}

export const serverRunDetailCalls: RunDetailCalls = {
  answer: (data) => answerQuestion({ data }),
  deny: (data) => denyPermission({ data }),
  cancel: (runId) => cancelRun({ data: { runId } }),
  removeWorktree: (runId) => removeRunWorktree({ data: { runId } }),
  control: (runId, control) => controlRun({ data: { runId, control } }),
  sendAgentMessage: (runId, body) => sendAgentMessage({ data: { runId, body } }),
  requestLog: (runId) => requestRunLog({ data: { runId } }),
};

export interface RunDetailWorld {
  queryClient: QueryClient;
  calls: RunDetailCalls;
  logRequested: () => void;
}

export function fetchCountOf(state: Pick<QueryState, "dataUpdateCount" | "errorUpdateCount">) {
  return state.dataUpdateCount + state.errorUpdateCount;
}

export function runDetailPollMs(page: RunDetailPage, logPolls: number): number | false {
  if (page.kind !== "found") return false;
  if (page.run.control?.status === "pending") return RUN_POLL_MS;
  if (
    page.run.timeline.some(
      (event) => event.kind === "operator-message" && event.delivery.status === "sending",
    )
  ) {
    return RUN_POLL_MS;
  }
  if (page.run.log.kind === "pending" && logPolls < LOG_POLL_LIMIT) return RUN_POLL_MS;
  return false;
}

export function runDetailMutations(world: RunDetailWorld, runId: string) {
  const { queryClient, calls } = world;
  const refreshRun = async (): Promise<void> => {
    await Promise.all(
      keysChangedByRunWrite(toRunId(runId)).map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  };
  const refreshLog = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: runDetailKey(runId) });
    world.logRequested();
  };
  return {
    answer: mutationOptions({
      mutationFn: (input: { questionId: string; answer: string }) =>
        rejectedAs(() => calls.answer({ runId, ...input }), ANSWER_REJECT_REASONS),
      onSuccess: refreshRun,
    }),
    deny: mutationOptions({
      mutationFn: (input: { promptId: string; reason: string }) =>
        rejectedAs(() => calls.deny({ runId, ...input }), DENY_REJECT_REASONS),
      onSuccess: refreshRun,
    }),
    cancel: mutationOptions({
      mutationFn: async () => okOrThrow<object, string>(await calls.cancel(runId)),
      onSuccess: refreshRun,
    }),
    removeWorktree: mutationOptions({
      mutationFn: async () => okOrThrow<object, string>(await calls.removeWorktree(runId)),
      onSuccess: refreshRun,
    }),
    control: mutationOptions({
      mutationFn: async (control: RunControl): Promise<RunControlOutcome> =>
        (await calls.control(runId, control)).ok ? "requested" : "state-changed",
      onSuccess: refreshRun,
    }),
    sendAgentMessage: mutationOptions({
      mutationFn: async (body: string): Promise<AgentMessageOutcome> =>
        (await calls.sendAgentMessage(toRunId(runId), body)).ok ? "requested" : "state-changed",
      onSuccess: refreshRun,
    }),
    refreshLog: mutationOptions({
      mutationFn: () => calls.requestLog(runId),
      onSuccess: refreshLog,
    }),
    openLog: mutationOptions({
      mutationFn: () => calls.requestLog(runId),
      onSuccess: (requested: boolean) => (requested ? refreshLog() : undefined),
    }),
  };
}

export function useRunDetailMutations(runId: string, logRequested: () => void) {
  const queryClient = useQueryClient();
  const mutations = useMemo(
    () => runDetailMutations({ queryClient, calls: serverRunDetailCalls, logRequested }, runId),
    [queryClient, runId, logRequested],
  );
  const answer = useMutation(mutations.answer);
  const deny = useMutation(mutations.deny);
  const cancel = useMutation(mutations.cancel);
  const removeWorktree = useMutation(mutations.removeWorktree);
  const control = useMutation(mutations.control);
  const agentMessage = useMutation(mutations.sendAgentMessage);
  const refreshLog = useMutation(mutations.refreshLog);
  const openLog = useMutation(mutations.openLog);
  const actions: RunDetailActions = {
    onAnswer: async (questionId, answerText) => {
      await answer.mutateAsync({ questionId, answer: answerText });
    },
    onDeny: async (promptId, reason) => {
      await deny.mutateAsync({ promptId, reason });
    },
    onCancel: async () => {
      await cancel.mutateAsync();
    },
    onRemoveWorktree: async () => {
      await removeWorktree.mutateAsync();
    },
    onControl: (next) => control.mutateAsync(next),
    onSendAgentMessage: (body) => agentMessage.mutateAsync(body),
    onRefreshLog: async () => {
      await refreshLog.mutateAsync();
    },
  };
  return { actions, openLog: openLog.mutate };
}

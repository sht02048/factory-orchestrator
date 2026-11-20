import {
  ANSWER_REJECT_REASONS,
  DENY_REJECT_REASONS,
  MutationRejectedError,
} from "../query/mutation-error";

export type AnswerRejectReason = (typeof ANSWER_REJECT_REASONS)[number];
export type DenyRejectReason = (typeof DENY_REJECT_REASONS)[number];

function rejectionOf<Reason extends string>(
  error: unknown,
  reasons: ReadonlyArray<Reason>,
): Reason | null {
  if (!(error instanceof MutationRejectedError)) return null;
  return reasons.find((reason) => reason === error.reason) ?? null;
}

export function answerRejection(error: unknown): AnswerRejectReason | null {
  return rejectionOf(error, ANSWER_REJECT_REASONS);
}

export function denyRejection(error: unknown): DenyRejectReason | null {
  return rejectionOf(error, DENY_REJECT_REASONS);
}

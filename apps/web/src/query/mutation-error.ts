import type { AnswerRejectedError, DenyRejectedError } from "@ganger/app/home/actions";

export class MutationRejectedError<Reason extends string = string> extends Error {
  readonly reason: Reason;

  constructor(reason: Reason, options: { cause?: unknown } = {}) {
    super(`mutation rejected: ${reason}`, options);
    this.name = "MutationRejectedError";
    this.reason = reason;
  }
}

export type MutationResult<Value, Reason extends string> =
  | ({ ok: true } & Value)
  | { ok: false; reason: Reason };

export function okOrThrow<Value, Reason extends string>(
  result: MutationResult<Value, Reason>,
): { ok: true } & Value {
  if (!result.ok) throw new MutationRejectedError(result.reason);
  return result;
}

export const ANSWER_REJECT_REASONS = [
  "not-found",
  "already-answered",
] as const satisfies ReadonlyArray<AnswerRejectedError["reason"]>;

export const DENY_REJECT_REASONS = [
  "not-found",
  "already-denied",
  "resolved",
] as const satisfies ReadonlyArray<DenyRejectedError["reason"]>;

const REJECTED_MESSAGE = /\brejected: ([a-z-]+)$/;

function isReason<Reason extends string>(
  value: unknown,
  reasons: ReadonlyArray<Reason>,
): value is Reason {
  return reasons.some((reason) => reason === value);
}

function thrownReason<Reason extends string>(
  error: unknown,
  reasons: ReadonlyArray<Reason>,
): Reason | null {
  if (typeof error !== "object" || error === null) return null;
  const reason: unknown = Reflect.get(error, "reason");
  if (isReason(reason, reasons)) return reason;
  const message: unknown = Reflect.get(error, "message");
  const parsed = typeof message === "string" ? REJECTED_MESSAGE.exec(message)?.[1] : undefined;
  return isReason(parsed, reasons) ? parsed : null;
}

export function toMutationError<Reason extends string>(
  error: unknown,
  reasons: ReadonlyArray<Reason>,
): MutationRejectedError<Reason> | Error {
  if (error instanceof MutationRejectedError && isReason(error.reason, reasons)) return error;
  const reason = thrownReason(error, reasons);
  if (reason !== null) return new MutationRejectedError(reason, { cause: error });
  return error instanceof Error ? error : new Error(String(error), { cause: error });
}

export function rejectionReasonOf<Reason extends string>(
  error: unknown,
  reasons: ReadonlyArray<Reason>,
): Reason | null {
  return thrownReason(error, reasons);
}

export async function rejectedAs<Value, Reason extends string>(
  call: () => Promise<Value>,
  reasons: ReadonlyArray<Reason>,
): Promise<Value> {
  try {
    return await call();
  } catch (error) {
    throw toMutationError(error, reasons);
  }
}

import { describe, expect, it } from "vitest";
import { AnswerRejectedError, DenyRejectedError } from "@ganger/app/home/actions";
import {
  ANSWER_REJECT_REASONS,
  DENY_REJECT_REASONS,
  MutationRejectedError,
  okOrThrow,
  rejectedAs,
  toMutationError,
} from "./mutation-error";

describe("mutation 오류 변환(스펙 0003 4.4, C5)", () => {
  it("{ ok: false, reason }은 이유를 지킨 MutationRejectedError로 throw한다", () => {
    const result: { ok: true; runId: string } | { ok: false; reason: "active-run" } = {
      ok: false,
      reason: "active-run",
    };
    expect(() => okOrThrow(result)).toThrow(MutationRejectedError);
    expect(() => okOrThrow(result)).toThrow(expect.objectContaining({ reason: "active-run" }));
  });

  it("ok 결과는 그대로 돌려준다", () => {
    expect(okOrThrow({ ok: true, runId: "run-1" })).toEqual({ ok: true, runId: "run-1" });
  });

  it("서버 함수가 throw한 답 거절은 같은 타입으로 바꾸고 이유를 지킨다", () => {
    const error = toMutationError(
      new AnswerRejectedError("already-answered"),
      ANSWER_REJECT_REASONS,
    );
    expect(error).toBeInstanceOf(MutationRejectedError);
    expect(error).toMatchObject({ reason: "already-answered" });
  });

  it("서버 함수 경계에서 reason 속성을 잃고 message만 남아도 이유를 읽는다", () => {
    const crossed = new Error(new DenyRejectedError("resolved").message);
    const error = toMutationError(crossed, DENY_REJECT_REASONS);
    expect(error).toBeInstanceOf(MutationRejectedError);
    expect(error).toMatchObject({ reason: "resolved", cause: crossed });
  });

  it("모르는 이유와 다른 오류는 그대로 둔다", () => {
    const network = new TypeError("Failed to fetch");
    expect(toMutationError(network, ANSWER_REJECT_REASONS)).toBe(network);
    expect(
      toMutationError(new Error("deny rejected: exploded"), DENY_REJECT_REASONS),
    ).not.toBeInstanceOf(MutationRejectedError);
  });

  it("rejectedAs는 throw한 오류를 같은 타입으로 바꿔 다시 throw한다", async () => {
    await expect(
      rejectedAs(() => Promise.reject(new AnswerRejectedError("not-found")), ANSWER_REJECT_REASONS),
    ).rejects.toMatchObject({ name: "MutationRejectedError", reason: "not-found" });
    await expect(rejectedAs(() => Promise.resolve("done"), ANSWER_REJECT_REASONS)).resolves.toBe(
      "done",
    );
  });
});

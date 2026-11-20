import { describe, expect, it } from "vitest";
import { MutationRejectedError } from "../query/mutation-error";
import { answerRejection, denyRejection } from "./rejection";

describe("답하기·거절의 거절 이유(스펙 0003 4.4)", () => {
  it("이유가 담긴 오류에서 그 화면이 아는 이유를 고른다", () => {
    expect(answerRejection(new MutationRejectedError("already-answered"))).toBe("already-answered");
    expect(denyRejection(new MutationRejectedError("resolved"))).toBe("resolved");
  });

  it("다른 화면의 이유와 네트워크 오류는 이유가 없다", () => {
    expect(answerRejection(new MutationRejectedError("resolved"))).toBeNull();
    expect(denyRejection(new TypeError("Failed to fetch"))).toBeNull();
  });
});

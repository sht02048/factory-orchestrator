import { describe, expect, it } from "vitest";
import { answerToSend, emptyDraft, pickChoice, pickOther, writeOther } from "./answer-draft";

const choices = ["지수 백오프", "30초 고정"];

describe("질문 레이어의 답 고르기(ADR 0010 6번)", () => {
  it("아무것도 고르지 않으면 보낼 답이 없어 보내기가 꺼진다", () => {
    expect(answerToSend(choices, emptyDraft)).toBeNull();
  });

  it("선택지를 고르면 그 문구가 보낼 답이 되고, 다른 선택지를 고르면 바뀐다", () => {
    const first = pickChoice(emptyDraft, 0);
    expect(answerToSend(choices, first)).toBe("지수 백오프");
    expect(answerToSend(choices, pickChoice(first, 1))).toBe("30초 고정");
  });

  it("직접 쓰기는 빈칸이면 보낼 답이 없고, 쓴 글을 앞뒤 공백 없이 보낸다", () => {
    const other = pickOther(pickChoice(emptyDraft, 0));
    expect(answerToSend(choices, other)).toBeNull();
    expect(answerToSend(choices, writeOther(other, "   "))).toBeNull();
    expect(answerToSend(choices, writeOther(other, "  1분마다 다시 해요 "))).toBe(
      "1분마다 다시 해요",
    );
  });

  it("직접 쓴 글은 선택지로 갔다 돌아와도 남는다", () => {
    const written = writeOther(emptyDraft, "직접 쓴 답");
    const back = pickOther(pickChoice(written, 1));
    expect(answerToSend(choices, back)).toBe("직접 쓴 답");
  });
});

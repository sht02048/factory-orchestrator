import { describe, expect, it } from "vitest";
import { endsWithFinalConsonant, subjectParticle } from "./particle";

describe("조사 고르기", () => {
  it("한글은 마지막 글자의 받침으로 고른다", () => {
    expect(endsWithFinalConsonant("배포")).toBe(false);
    expect(endsWithFinalConsonant("빌드 명령")).toBe(true);
    expect(subjectParticle("맥미니")).toBe("ga");
    expect(subjectParticle("서버실")).toBe("i");
  });

  it("숫자는 한국어로 읽은 소리의 받침으로 고른다", () => {
    expect(endsWithFinalConsonant("#1")).toBe(true);
    expect(endsWithFinalConsonant("#2")).toBe(false);
    expect(endsWithFinalConsonant("#13")).toBe(true);
    expect(endsWithFinalConsonant("#24")).toBe(false);
  });

  it("영문은 끝 글자 이름의 받침으로 고르고 끝 문장부호는 건너뛴다", () => {
    expect(subjectParticle("runner-a")).toBe("ga");
    expect(subjectParticle("build-farm")).toBe("i");
    expect(endsWithFinalConsonant("git push --force")).toBe(false);
    expect(endsWithFinalConsonant("rm -rf build/")).toBe(false);
    expect(endsWithFinalConsonant("make clean")).toBe(true);
    expect(endsWithFinalConsonant('"pnpm install"')).toBe(true);
    expect(endsWithFinalConsonant("staging")).toBe(true);
  });

  it("읽을 글자가 없으면 받침 없는 쪽을 고른다", () => {
    expect(endsWithFinalConsonant("")).toBe(false);
    expect(endsWithFinalConsonant("...")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { endsWithFinalConsonant, objectParticle, subjectParticle } from "./particle";

describe("조사 고르기", () => {
  it("한글은 마지막 글자의 받침으로 고른다", () => {
    expect(objectParticle("배포")).toBe("reul");
    expect(objectParticle("빌드 명령")).toBe("eul");
    expect(subjectParticle("맥미니")).toBe("ga");
    expect(subjectParticle("서버실")).toBe("i");
  });

  it("숫자는 한국어로 읽은 소리의 받침으로 고른다", () => {
    expect(objectParticle("#1")).toBe("eul");
    expect(objectParticle("#2")).toBe("reul");
    expect(objectParticle("#13")).toBe("eul");
    expect(objectParticle("#24")).toBe("reul");
  });

  it("영문은 끝 글자 이름의 받침으로 고르고 끝 문장부호는 건너뛴다", () => {
    expect(subjectParticle("runner-a")).toBe("ga");
    expect(subjectParticle("build-farm")).toBe("i");
    expect(objectParticle("git push --force")).toBe("reul");
    expect(objectParticle("rm -rf build/")).toBe("reul");
    expect(objectParticle("make clean")).toBe("eul");
    expect(objectParticle('"pnpm install"')).toBe("eul");
    expect(endsWithFinalConsonant("staging")).toBe(true);
  });

  it("읽을 글자가 없으면 받침 없는 쪽을 고른다", () => {
    expect(endsWithFinalConsonant("")).toBe(false);
    expect(endsWithFinalConsonant("...")).toBe(false);
  });
});

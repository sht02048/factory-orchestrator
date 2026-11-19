import { describe, expect, it } from "vitest";

import { existingTagAction, tagDecision } from "./release-tag.ts";

const same = (version: string) => ({ root: version, desktop: version });

describe("tagDecision", () => {
  it("버전이 그대로면 태그를 만들지 않는다", () => {
    expect(tagDecision(same("0.1.0-rc.1"), same("0.1.0-rc.1"))).toEqual({
      kind: "none",
      reason: "the version is still 0.1.0-rc.1",
    });
  });

  it("앞 커밋을 볼 수 없으면 태그를 만들지 않는다", () => {
    expect(tagDecision(null, same("0.1.0")).kind).toBe("none");
  });

  it("두 버전을 함께 올리면 그 버전의 태그를 만든다", () => {
    expect(tagDecision(same("0.1.0-rc.1"), same("0.1.0-rc.2"))).toEqual({
      kind: "tag",
      tag: "v0.1.0-rc.2",
      version: "0.1.0-rc.2",
    });
    expect(tagDecision(same("0.1.0-rc.2"), same("0.1.0"))).toEqual({
      kind: "tag",
      tag: "v0.1.0",
      version: "0.1.0",
    });
  });

  it("하나만 올리거나 둘이 다르면 실패한다", () => {
    expect(() => tagDecision(same("0.1.0"), { root: "0.2.0", desktop: "0.1.0" })).toThrow("differ");
    expect(() => tagDecision(same("0.1.0"), { root: "0.2.0", desktop: "0.2.1" })).toThrow("differ");
  });

  it("버전을 낮추거나 같은 버전으로 되돌리면 실패한다", () => {
    expect(() => tagDecision(same("0.2.0"), same("0.1.0"))).toThrow("is not higher");
    expect(() => tagDecision(same("0.1.0"), same("0.1.0-rc.3"))).toThrow("is not higher");
  });

  it("앞 커밋의 두 버전이 달랐으면 둘 다보다 높아야 한다", () => {
    expect(() => tagDecision({ root: "0.2.0", desktop: "0.3.0" }, same("0.2.1"))).toThrow(
      "is not higher than the previous version 0.3.0",
    );
    expect(tagDecision({ root: "0.2.0", desktop: "0.1.0" }, same("0.2.1")).kind).toBe("tag");
  });

  it("형식이 틀린 버전은 실패한다", () => {
    expect(() => tagDecision(same("0.1.0"), same("0.2"))).toThrow("is not a release version");
  });

  it("앞 버전의 형식이 틀렸어도 새 버전이 맞으면 태그를 만든다", () => {
    expect(tagDecision(same("next"), same("0.1.0")).kind).toBe("tag");
  });
});

describe("existingTagAction", () => {
  const commit = "a".repeat(40);

  it("태그가 없으면 만든다", () => {
    expect(existingTagAction("v0.1.0", null, commit)).toBe("create");
  });

  it("같은 커밋에 이미 있으면 건너뛴다", () => {
    expect(existingTagAction("v0.1.0", commit, commit)).toBe("skip");
  });

  it("다른 커밋에 있으면 실패한다", () => {
    expect(() => existingTagAction("v0.1.0", "b".repeat(40), commit)).toThrow(
      `v0.1.0 already points at ${"b".repeat(40)}`,
    );
  });
});

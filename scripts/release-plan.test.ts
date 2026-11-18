import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { packageVersion, previousStableTag, releasePlan } from "./release-plan.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

function declaredVersion(path: string): string {
  return packageVersion(readFileSync(join(root, path), "utf8"), path);
}

describe("저장소의 릴리스 버전", () => {
  it("루트와 데스크톱 앱 버전이 같아 그 버전의 태그로 릴리스 계획을 세운다", () => {
    const rootVersion = declaredVersion("package.json");
    const desktopVersion = declaredVersion(join("apps", "desktop", "package.json"));
    expect(desktopVersion).toBe(rootVersion);
    expect(
      releasePlan({ tag: `v${rootVersion}`, rootVersion, desktopVersion, tags: [] }).version,
    ).toBe(rootVersion);
  });

  it("v0.1.0-rc.1 태그는 0.1.0-rc.1 버전과 맞고 prerelease 로 올린다", () => {
    expect(
      releasePlan({
        tag: "v0.1.0-rc.1",
        rootVersion: "0.1.0-rc.1",
        desktopVersion: "0.1.0-rc.1",
        tags: ["v0.1.0-rc.1"],
      }),
    ).toEqual({ version: "0.1.0-rc.1", prerelease: true, notesStartTag: null });
  });
});

describe("releasePlan", () => {
  const tags = ["v0.1.0-rc.1", "v0.1.0-rc.2", "v0.1.0", "v0.1.1", "v0.2.0-rc.1", "v0.10.0"];

  it("정식 태그는 prerelease 가 아니고 앞 정식 태그부터 노트를 모은다", () => {
    expect(
      releasePlan({ tag: "v0.2.0", rootVersion: "0.2.0", desktopVersion: "0.2.0", tags }),
    ).toEqual({ version: "0.2.0", prerelease: false, notesStartTag: "v0.1.1" });
  });

  it("'-' 가 있는 태그는 prerelease 이고 노트 시작 태그를 정하지 않는다", () => {
    expect(
      releasePlan({
        tag: "v0.2.0-rc.1",
        rootVersion: "0.2.0-rc.1",
        desktopVersion: "0.2.0-rc.1",
        tags,
      }),
    ).toEqual({ version: "0.2.0-rc.1", prerelease: true, notesStartTag: null });
  });

  it("첫 정식 태그는 앞 정식 태그가 없어 rc 를 시작으로 삼지 않는다", () => {
    expect(
      releasePlan({
        tag: "v0.1.0",
        rootVersion: "0.1.0",
        desktopVersion: "0.1.0",
        tags: ["v0.1.0-rc.1", "v0.1.0"],
      }).notesStartTag,
    ).toBeNull();
  });

  it("데스크톱 앱 버전이 태그와 다르면 멈춘다", () => {
    expect(() =>
      releasePlan({ tag: "v0.2.0", rootVersion: "0.2.0", desktopVersion: "0.1.1", tags }),
    ).toThrow("apps/desktop/package.json version 0.1.1");
  });

  it("루트 버전이 태그와 다르면 멈춘다", () => {
    expect(() =>
      releasePlan({ tag: "v0.2.0", rootVersion: "0.1.1", desktopVersion: "0.2.0", tags }),
    ).toThrow("package.json version 0.1.1");
  });

  it("버전 꼴이 아닌 태그는 멈춘다", () => {
    for (const tag of ["v1.2", "1.2.3", "v1.2.3-", "vnext"]) {
      expect(() =>
        releasePlan({ tag, rootVersion: "1.2.3", desktopVersion: "1.2.3", tags }),
      ).toThrow("is not a release tag");
    }
  });
});

describe("previousStableTag", () => {
  it("숫자 크기로 비교해 v0.10.0 앞의 정식 태그는 v0.9.2 다", () => {
    expect(previousStableTag("v0.10.0", ["v0.2.0", "v0.9.2", "v0.9.10-rc.1", "v0.10.0"])).toBe(
      "v0.9.2",
    );
  });

  it("뒤 버전의 태그는 고르지 않는다", () => {
    expect(previousStableTag("v0.2.0", ["v0.3.0", "v1.0.0"])).toBeNull();
  });
});

describe("packageVersion", () => {
  it("version 문자열을 읽는다", () => {
    expect(packageVersion('{"name":"ganger","version":"0.1.0"}', "package.json")).toBe("0.1.0");
  });

  it("version 이 없으면 멈춘다", () => {
    expect(() => packageVersion('{"version":1}', "package.json")).toThrow(
      "package.json has no version",
    );
  });
});

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertVersionBump,
  bumpVersions,
  compareVersions,
  isReleaseVersion,
  withPackageVersion,
} from "./release-version.ts";

describe("compareVersions", () => {
  it("숫자 크기로 비교한다", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.1.1", "0.2.0")).toBe(-1);
  });

  it("prerelease 는 같은 정식 버전보다 낮다", () => {
    expect(compareVersions("0.1.0-rc.1", "0.1.0")).toBe(-1);
    expect(compareVersions("0.1.0", "0.1.0-rc.9")).toBe(1);
  });

  it("prerelease 의 숫자 낱말은 숫자로 비교한다", () => {
    expect(compareVersions("0.1.0-rc.10", "0.1.0-rc.9")).toBe(1);
    expect(compareVersions("0.1.0-rc.1", "0.1.0-rc.2")).toBe(-1);
  });

  it("숫자 낱말은 글자 낱말보다 낮고, 낱말이 더 많으면 높다", () => {
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareVersions("1.0.0-alpha.beta", "1.0.0-beta")).toBe(-1);
  });
});

describe("isReleaseVersion", () => {
  it("1.2.3 과 1.2.3-rc.1 꼴만 받는다", () => {
    expect(isReleaseVersion("1.2.3")).toBe(true);
    expect(isReleaseVersion("0.1.0-rc.1")).toBe(true);
    for (const version of [
      "v1.2.3",
      "1.2",
      "01.2.3",
      "1.2.3-",
      "1.2.3-rc..1",
      "1.2.3+build",
      "1.2.3-rc.01",
    ]) {
      expect(isReleaseVersion(version)).toBe(false);
    }
  });
});

describe("assertVersionBump", () => {
  it("높은 버전은 통과한다", () => {
    expect(() => assertVersionBump("0.1.0-rc.1", "0.1.0-rc.2")).not.toThrow();
    expect(() => assertVersionBump("0.1.0-rc.2", "0.1.0")).not.toThrow();
  });

  it("같거나 낮은 버전은 멈춘다", () => {
    expect(() => assertVersionBump("0.1.0", "0.1.0")).toThrow("is not higher");
    expect(() => assertVersionBump("0.1.0", "0.1.0-rc.3")).toThrow("is not higher");
  });

  it("형식이 틀린 버전은 멈춘다", () => {
    expect(() => assertVersionBump("0.1.0", "v0.2.0")).toThrow("is not a release version");
  });
});

describe("withPackageVersion", () => {
  const json = '{\n  "name": "ganger",\n  "version": "0.1.0-rc.1",\n  "private": true\n}\n';

  it("맨 위 version 줄만 바꾸고 나머지 모양은 그대로 둔다", () => {
    expect(withPackageVersion(json, "package.json", "0.1.0")).toBe(
      '{\n  "name": "ganger",\n  "version": "0.1.0",\n  "private": true\n}\n',
    );
  });

  it("맨 위 version 줄이 없으면 멈춘다", () => {
    expect(() => withPackageVersion('{\n  "name": "x"\n}\n', "package.json", "1.0.0")).toThrow(
      "no top-level version line",
    );
  });
});

describe("bumpVersions", () => {
  const roots: string[] = [];

  function repo(rootVersion: string, desktopVersion: string): string {
    const root = mkdtempSync(join(tmpdir(), "release-version-"));
    roots.push(root);
    mkdirSync(join(root, "apps", "desktop"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      `{\n  "name": "ganger",\n  "version": "${rootVersion}",\n  "dependencies": {\n    "x": "1.0.0"\n  }\n}\n`,
    );
    writeFileSync(
      join(root, "apps", "desktop", "package.json"),
      `{\n  "name": "@ganger/desktop",\n  "version": "${desktopVersion}"\n}\n`,
    );
    return root;
  }

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("루트와 데스크톱 앱의 버전을 함께 올린다", () => {
    const root = repo("0.1.0-rc.1", "0.1.0-rc.1");
    expect(bumpVersions(root, "0.1.0-rc.2")).toBe("0.1.0-rc.1");
    expect(readFileSync(join(root, "package.json"), "utf8")).toContain('"version": "0.1.0-rc.2"');
    expect(readFileSync(join(root, "package.json"), "utf8")).toContain('"x": "1.0.0"');
    expect(readFileSync(join(root, "apps", "desktop", "package.json"), "utf8")).toContain(
      '"version": "0.1.0-rc.2"',
    );
  });

  it("두 버전이 다르면 아무것도 쓰지 않고 멈춘다", () => {
    const root = repo("0.1.0", "0.1.0-rc.1");
    expect(() => bumpVersions(root, "0.2.0")).toThrow("differs from");
    expect(readFileSync(join(root, "package.json"), "utf8")).toContain('"version": "0.1.0"');
  });

  it("낮추는 버전은 아무것도 쓰지 않고 멈춘다", () => {
    const root = repo("0.2.0", "0.2.0");
    expect(() => bumpVersions(root, "0.1.0")).toThrow("is not higher");
    expect(readFileSync(join(root, "package.json"), "utf8")).toContain('"version": "0.2.0"');
  });
});

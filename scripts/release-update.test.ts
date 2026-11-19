import { describe, expect, it } from "vitest";

import {
  MANUAL_UPDATE_NOTICE,
  manualUpdateNotice,
  releaseRepository,
  updateArtifacts,
} from "./release-update.ts";

describe("releaseRepository", () => {
  it("Actions 가 주는 저장소 이름을 쓰고, 따로 정하면 그것을 먼저 쓴다", () => {
    expect(releaseRepository({ GITHUB_REPOSITORY: "acme/ganger" })).toBe("acme/ganger");
    expect(
      releaseRepository({ GITHUB_REPOSITORY: "acme/ganger", GANGER_RELEASE_REPOSITORY: "ex/fork" }),
    ).toBe("ex/fork");
    expect(releaseRepository({})).toBeNull();
  });

  it("모양이 다르면 피드를 잘못 만들지 않고 멈춘다", () => {
    expect(() => releaseRepository({ GITHUB_REPOSITORY: "https://github.com/acme/x" })).toThrow(
      "must look like owner/name",
    );
  });
});

describe("updateArtifacts", () => {
  it("Release 에 올릴 zip 이름과 그 zip 을 가리키는 Squirrel.Mac 피드를 만든다", () => {
    const artifacts = updateArtifacts({
      repository: "acme/ganger",
      tag: "v0.2.0-rc.1",
      version: "0.2.0-rc.1",
      arch: "arm64",
      publishedAt: "2026-11-19T00:00:00.000Z",
    });
    expect(artifacts.zipName).toBe("Ganger-0.2.0-rc.1-darwin-arm64.zip");
    expect(artifacts.feedName).toBe("ganger-update-darwin-arm64.json");
    expect(JSON.parse(artifacts.feed)).toEqual({
      currentRelease: "0.2.0-rc.1",
      releases: [
        {
          version: "0.2.0-rc.1",
          updateTo: {
            version: "0.2.0-rc.1",
            name: "0.2.0-rc.1",
            notes: "https://github.com/acme/ganger/releases/tag/v0.2.0-rc.1",
            pub_date: "2026-11-19T00:00:00.000Z",
            url: "https://github.com/acme/ganger/releases/download/v0.2.0-rc.1/Ganger-0.2.0-rc.1-darwin-arm64.zip",
          },
        },
      ],
    });
  });

  it("태그와 버전이 다르면 멈춘다", () => {
    expect(() =>
      updateArtifacts({
        repository: "acme/ganger",
        tag: "v0.2.1",
        version: "0.2.0",
        arch: "arm64",
        publishedAt: "2026-11-19T00:00:00.000Z",
      }),
    ).toThrow("does not match");
  });
});

describe("manualUpdateNotice", () => {
  it("0.3.0 전의 Release 본문에는 0.1.0 설치자에게 한 번 손으로 받으라는 안내를 넣는다", () => {
    expect(manualUpdateNotice("0.1.0-rc.5")).toBe(MANUAL_UPDATE_NOTICE);
    expect(manualUpdateNotice("0.2.3")).toBe(MANUAL_UPDATE_NOTICE);
    expect(manualUpdateNotice("0.3.0-rc.1")).toBe(MANUAL_UPDATE_NOTICE);
    expect(manualUpdateNotice("0.3.0")).toBeNull();
    expect(MANUAL_UPDATE_NOTICE).toContain("Download the dmg below once");
  });
});

import { describe, expect, it } from "vitest";
import {
  compareVersions,
  newestRelease,
  normalizeVersion,
  releasesApiUrl,
  repositorySchema,
  squirrelFeed,
  updateFeedName,
} from "./releases.js";

function release(
  tag: string,
  options: { prerelease?: boolean; draft?: boolean; feed?: boolean; arch?: string } = {},
) {
  const arch = options.arch ?? "arm64";
  return {
    tag_name: tag,
    html_url: `https://github.com/acme/ganger/releases/tag/${tag}`,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? false,
    assets:
      options.feed === false
        ? [{ name: "Ganger.dmg", browser_download_url: "https://example.com/Ganger.dmg" }]
        : [
            {
              name: updateFeedName(arch),
              browser_download_url: `https://github.com/acme/ganger/releases/download/${tag}/${updateFeedName(arch)}`,
            },
          ],
  };
}

describe("compareVersions", () => {
  it("정식 버전이 같은 숫자의 rc 보다 높다", () => {
    expect(compareVersions("0.2.0", "0.2.0-rc.1")).toBe(1);
    expect(compareVersions("0.2.0-rc.2", "0.2.0-rc.10")).toBe(-1);
    expect(compareVersions("v0.10.0", "0.9.9")).toBe(1);
  });

  it("버전이 아닌 문자열은 받지 않는다", () => {
    expect(normalizeVersion("latest")).toBeNull();
    expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
    expect(() => compareVersions("x", "1.0.0")).toThrow("not a version: x");
  });
});

describe("newestRelease", () => {
  it("지금보다 높은 정식 버전 중 가장 높은 것과 그 피드 주소를 고른다", () => {
    const found = newestRelease(
      [release("v0.1.0"), release("v0.3.0"), release("v0.2.0")],
      "0.1.0",
      "arm64",
    );
    expect(found).toEqual({
      version: "0.3.0",
      notesUrl: "https://github.com/acme/ganger/releases/tag/v0.3.0",
      feedUrl: `https://github.com/acme/ganger/releases/download/v0.3.0/${updateFeedName("arm64")}`,
    });
  });

  it("정식 버전을 쓰면 rc 는 고르지 않고, rc 를 쓰면 rc 도 고른다", () => {
    const list = [release("v0.2.0-rc.1", { prerelease: true }), release("v0.1.1")];
    expect(newestRelease(list, "0.1.0", "arm64")?.version).toBe("0.1.1");
    expect(newestRelease(list, "0.1.0-rc.4", "arm64")?.version).toBe("0.2.0-rc.1");
  });

  it("초안, 업데이트 파일이 없는 Release, 다른 아키텍처 Release 는 건너뛴다", () => {
    const list = [
      release("v0.4.0", { draft: true }),
      release("v0.3.0", { feed: false }),
      release("v0.2.5", { arch: "x64" }),
      release("v0.2.0"),
    ];
    expect(newestRelease(list, "0.1.0", "arm64")?.version).toBe("0.2.0");
  });

  it("새 버전이 없으면 null 이다", () => {
    expect(newestRelease([release("v0.1.0")], "0.1.0", "arm64")).toBeNull();
    expect(newestRelease([], "0.1.0", "arm64")).toBeNull();
  });

  it("모양이 다른 항목은 건너뛰고, 목록이 아니면 실패한다", () => {
    expect(
      newestRelease(
        [{ tag_name: 3 }, { ...release("v0.2.0"), html_url: "http://x" }],
        "0.1.0",
        "arm64",
      ),
    ).toBeNull();
    expect(() => newestRelease({ message: "Not Found" }, "0.1.0", "arm64")).toThrow(
      "expected array",
    );
  });
});

describe("repositorySchema", () => {
  it("owner/name 모양만 받는다", () => {
    expect(repositorySchema.safeParse("acme/ganger").success).toBe(true);
    const bad = ["acme", "acme/ganger/x", "../x", "acme/..", "https://github.com/acme/x"];
    expect(bad.filter((value) => repositorySchema.safeParse(value).success)).toEqual([]);
    expect(releasesApiUrl("acme/ganger")).toBe(
      "https://api.github.com/repos/acme/ganger/releases?per_page=30",
    );
  });
});

describe("squirrelFeed", () => {
  it("Squirrel.Mac JSON 피드 모양으로 새 버전과 zip 주소를 적는다", () => {
    expect(
      squirrelFeed({
        version: "0.2.0",
        zipUrl:
          "https://github.com/acme/ganger/releases/download/v0.2.0/Ganger-0.2.0-darwin-arm64.zip",
        notesUrl: "https://github.com/acme/ganger/releases/tag/v0.2.0",
        publishedAt: "2026-11-19T00:00:00.000Z",
      }),
    ).toEqual({
      currentRelease: "0.2.0",
      releases: [
        {
          version: "0.2.0",
          updateTo: {
            version: "0.2.0",
            name: "0.2.0",
            notes: "https://github.com/acme/ganger/releases/tag/v0.2.0",
            pub_date: "2026-11-19T00:00:00.000Z",
            url: "https://github.com/acme/ganger/releases/download/v0.2.0/Ganger-0.2.0-darwin-arm64.zip",
          },
        },
      ],
    });
  });
});

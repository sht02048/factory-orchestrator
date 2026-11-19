import { describe, expect, it } from "vitest";

import { dmgProblems, parseRecursiveXattr, type MountedVolume } from "./check-dmg.ts";

function utf16be(text: string): Buffer {
  return Buffer.from(text, "utf16le").swap16();
}

const dsStore = Buffer.concat([
  Buffer.from("Bud1"),
  utf16be("Applications"),
  Buffer.from("Ilocblob"),
  utf16be("Ganger.app"),
  Buffer.from("Ilocblob"),
  Buffer.from("bwspblob"),
  Buffer.from("icvpblob"),
]);

const complete: MountedVolume = {
  names: [".DS_Store", ".VolumeIcon.icns", ".background.tiff", "Applications", "Ganger.app"],
  applicationsLink: "/Applications",
  dsStore,
  appAttributes: [],
};

describe("dmgProblems", () => {
  it("설치 창에 필요한 것이 모두 있으면 문제가 없다", () => {
    expect(dmgProblems(complete)).toEqual([]);
  });

  it("hdiutil 로만 묶은 dmg 는 창 설정·배경·볼륨 아이콘이 없다고 알린다", () => {
    expect(
      dmgProblems({
        names: ["Applications", "Ganger.app"],
        applicationsLink: "/Applications",
        dsStore: null,
        appAttributes: [],
      }),
    ).toEqual(["background image is missing", "volume icon is missing", ".DS_Store is missing"]);
  });

  it("Applications 가 /Applications 링크가 아니거나 앱이 없으면 알린다", () => {
    expect(
      dmgProblems({
        ...complete,
        names: complete.names.filter((name) => name !== "Ganger.app"),
        applicationsLink: null,
      }),
    ).toEqual(["Ganger.app is missing", "Applications is not a link to /Applications"]);
  });

  it(".DS_Store 에 아이콘 위치나 창 설정이 빠지면 알린다", () => {
    expect(
      dmgProblems({
        ...complete,
        dsStore: Buffer.concat([Buffer.from("Bud1Iloc"), utf16be("Ganger.app")]),
      }),
    ).toEqual([
      ".DS_Store has no bwsp record",
      ".DS_Store has no icvp record",
      ".DS_Store has no icon position for Applications",
    ]);
  });

  it("앱 번들 어디든 codesign --strict 가 거부하는 FinderInfo·ResourceFork xattr 이 있으면 알린다", () => {
    expect(
      dmgProblems({
        ...complete,
        appAttributes: [
          { path: "Ganger.app", name: "com.apple.FinderInfo" },
          { path: "Ganger.app", name: "com.apple.provenance" },
          { path: "Ganger.app/Contents/Resources/icon.icns", name: "com.apple.ResourceFork" },
        ],
      }),
    ).toEqual([
      "Ganger.app has the com.apple.FinderInfo xattr, which codesign --strict rejects",
      "Ganger.app/Contents/Resources/icon.icns has the com.apple.ResourceFork xattr, which codesign --strict rejects",
    ]);
  });

  it("PNG 배경도 배경으로 인정한다", () => {
    expect(
      dmgProblems({
        ...complete,
        names: complete.names.map((name) =>
          name === ".background.tiff" ? ".background.png" : name,
        ),
      }),
    ).toEqual([]);
  });
});

describe("parseRecursiveXattr", () => {
  it("xattr -r 출력을 앱 번들 안 상대 경로와 xattr 이름으로 나눈다", () => {
    const root = "/Volumes/Ganger: rc/Ganger.app";
    expect(
      parseRecursiveXattr(
        [
          `${root}: com.apple.FinderInfo`,
          `${root}/Contents/MacOS/Ganger: com.apple.provenance`,
          "/Volumes/Ganger: rc/Applications: com.apple.FinderInfo",
          "",
        ].join("\n"),
        root,
      ),
    ).toEqual([
      { path: "Ganger.app", name: "com.apple.FinderInfo" },
      { path: "Ganger.app/Contents/MacOS/Ganger", name: "com.apple.provenance" },
    ]);
  });
});

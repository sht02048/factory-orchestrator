import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { actoolMajorVersion, appIconPaths } from "./app-icon";

const versionPlist = (version: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>com.apple.actool.version</key><dict>
<key>bundle-version</key><string>24000</string>
<key>short-bundle-version</key><string>${version}</string>
</dict></dict></plist>`;

describe("앱 아이콘 고르기", () => {
  it("actool 판 번호를 읽는다", () => {
    expect(actoolMajorVersion(versionPlist("26.1"))).toBe(26);
    expect(actoolMajorVersion(versionPlist("16.0"))).toBe(16);
    expect(actoolMajorVersion("xcode-select: error: tool 'actool' requires Xcode")).toBeNull();
  });

  it("Xcode 26 이상의 actool 이 있으면 .icns 와 .icon 을 함께 넘긴다", () => {
    expect(appIconPaths("/icons", versionPlist("26.0"))).toEqual([
      join("/icons", "icon.icns"),
      join("/icons", "AppIcon.icon"),
    ]);
  });

  it(".icon 은 .icns 와 이름이 달라 packager 가 확장자만 바꿔 찾아내지 않는다", () => {
    const [icns, composer] = appIconPaths("/icons", versionPlist("26.0"));
    expect(composer).not.toEqual(icns?.replace(/\.icns$/, ".icon"));
  });

  it("actool 이 없거나 낮으면 .icns 만 넘겨 패키징이 깨지지 않는다", () => {
    expect(appIconPaths("/icons", null)).toEqual([join("/icons", "icon.icns")]);
    expect(appIconPaths("/icons", versionPlist("16.4"))).toEqual([join("/icons", "icon.icns")]);
  });
});

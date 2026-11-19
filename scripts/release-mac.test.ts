import { describe, expect, it } from "vitest";

import { existsSync } from "node:fs";

import { BACKGROUND_PNG } from "./dmg-background.ts";
import { developerIdIdentity, dmgbuildArgs, notaryStatus, signingFromEnv } from "./release-mac.ts";

describe("signingFromEnv", () => {
  it("공증 값이 하나도 없으면 서명하지 않는다", () => {
    expect(signingFromEnv({})).toEqual({ kind: "unsigned" });
    expect(signingFromEnv({ APPLE_API_KEY_PATH: "" })).toEqual({ kind: "unsigned" });
  });

  it("공증 값 셋이 모두 있으면 서명한다", () => {
    expect(
      signingFromEnv({
        APPLE_API_KEY_PATH: "/tmp/AuthKey.p8",
        APPLE_API_KEY_ID: "KEYID",
        APPLE_API_ISSUER: "issuer",
        MACOS_SIGN_KEYCHAIN: "/tmp/release.keychain-db",
      }),
    ).toEqual({
      kind: "signed",
      notary: { keyPath: "/tmp/AuthKey.p8", keyId: "KEYID", issuer: "issuer" },
      keychain: "/tmp/release.keychain-db",
    });
  });

  it("키체인을 정하지 않으면 기본 키체인 목록에서 찾는다", () => {
    expect(
      signingFromEnv({ APPLE_API_KEY_PATH: "k", APPLE_API_KEY_ID: "i", APPLE_API_ISSUER: "s" }),
    ).toMatchObject({ kind: "signed", keychain: null });
  });

  it("키체인만 있고 공증 값이 없으면 서명 없는 dmg 로 넘어가지 않고 멈춘다", () => {
    expect(() => signingFromEnv({ MACOS_SIGN_KEYCHAIN: "/tmp/release.keychain-db" })).toThrow(
      "MACOS_SIGN_KEYCHAIN is set without",
    );
  });

  it("공증 값이 일부만 있으면 서명 없는 dmg 로 넘어가지 않고 멈춘다", () => {
    expect(() => signingFromEnv({ APPLE_API_KEY_PATH: "k", APPLE_API_KEY_ID: "i" })).toThrow(
      "Missing: APPLE_API_ISSUER",
    );
  });
});

describe("developerIdIdentity", () => {
  const developerId = `  1) ${"A".repeat(40)} "Developer ID Application: Acme Inc (TEAMID1234)"`;
  const development = `  2) ${"B".repeat(40)} "Apple Development: dev@example.com (ABCDE12345)"`;

  it("Developer ID Application 인증서 하나의 해시를 고른다", () => {
    const output = [developerId, development, "     2 valid identities found"].join("\n");
    expect(developerIdIdentity(output)).toBe("A".repeat(40));
  });

  it("없으면 멈춘다", () => {
    expect(() => developerIdIdentity(`${development}\n     1 valid identities found`)).toThrow(
      "No valid",
    );
  });

  it("둘 이상이면 고르지 않고 멈춘다", () => {
    const other = `  3) ${"C".repeat(40)} "Developer ID Application: Acme Inc (TEAMID1234)"`;
    expect(() => developerIdIdentity([developerId, other].join("\n"))).toThrow("More than one");
  });

  it("같은 인증서가 두 키체인에서 보여도 하나로 센다", () => {
    expect(developerIdIdentity([developerId, developerId].join("\n"))).toBe("A".repeat(40));
  });
});

describe("notaryStatus", () => {
  it("notarytool 의 JSON 출력에서 id 와 status 를 읽는다", () => {
    expect(
      notaryStatus('{"id":"2f1c","status":"Accepted","message":"Processing complete"}'),
    ).toEqual({ id: "2f1c", status: "Accepted" });
  });

  it("모양이 다르면 멈춘다", () => {
    expect(() => notaryStatus('{"message":"no"}')).toThrow("Unexpected notarytool output");
    expect(() => notaryStatus("")).toThrow("Unexpected notarytool output");
  });
});

describe("dmgbuildArgs", () => {
  const args = dmgbuildArgs({
    root: "/repo",
    app: "/repo/dist/release/work/app/Ganger.app",
    dmg: "/repo/dist/release/Ganger-1.0.0-arm64.dmg",
  });

  it("저장소의 설정 파일과 앱·배경·볼륨 아이콘으로 Ganger 볼륨을 만든다", () => {
    expect(args).toEqual([
      "-s",
      "/repo/scripts/dmg-settings.py",
      "-D",
      "app=/repo/dist/release/work/app/Ganger.app",
      "-D",
      `background=${BACKGROUND_PNG}`,
      "-D",
      "icon=/repo/apps/desktop/icons/icon.icns",
      "Ganger",
      "/repo/dist/release/Ganger-1.0.0-arm64.dmg",
    ]);
  });

  it("배경 그림은 저장소에 있는 파일을 쓴다", () => {
    expect(existsSync(BACKGROUND_PNG)).toBe(true);
  });
});

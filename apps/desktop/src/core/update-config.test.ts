import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  UPDATE_REPOSITORY_ENV,
  blockedReason,
  updateConfigJson,
  updateRepository,
} from "./update-config.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ganger-update-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("updateRepository", () => {
  it("패키징 때 적은 저장소 주소를 읽는다", () => {
    const file = join(dir, "app-update.json");
    writeFileSync(file, updateConfigJson("acme/ganger"));
    expect(updateRepository(file, {})).toBe("acme/ganger");
  });

  it("환경 변수가 있으면 그 주소를 먼저 쓴다", () => {
    const file = join(dir, "app-update.json");
    writeFileSync(file, updateConfigJson("acme/ganger"));
    expect(updateRepository(file, { [UPDATE_REPOSITORY_ENV]: "example/fork" })).toBe(
      "example/fork",
    );
  });

  it("파일이 없거나 모양이 다르면 업데이트 주소가 없다", () => {
    expect(updateRepository(null, {})).toBeNull();
    expect(updateRepository(join(dir, "missing.json"), {})).toBeNull();
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ repository: "https://github.com/acme/ganger" }));
    expect(updateRepository(file, { [UPDATE_REPOSITORY_ENV]: "not a repo" })).toBeNull();
  });

  it("모양이 다른 저장소 주소로는 설정 파일을 만들지 않는다", () => {
    expect(() => updateConfigJson("acme")).toThrow("Invalid string");
  });
});

describe("blockedReason", () => {
  it("Applications 밖이면 옮기라고, 쓸 수 없으면 권한이 없다고 본다", () => {
    expect(blockedReason({ inApplications: false, writable: true })).toBe("outside-applications");
    expect(blockedReason({ inApplications: true, writable: false })).toBe("no-permission");
    expect(blockedReason({ inApplications: true, writable: true })).toBeNull();
  });
});

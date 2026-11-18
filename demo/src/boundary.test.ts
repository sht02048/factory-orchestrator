import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findDevMarkers } from "../../scripts/check-dev-code.ts";
import { PREFILL } from "./values.js";

/*
 * 가짜 어댑터가 제품 코드에 들어가지 않는다는 경계 시험(티켓 0047). 빌드 산출물은 CI 의 빌드 뒤 단계
 * (scripts/check-dev-code.ts)가 보고, 여기서는 빌드 없이 소스의 import 경계를 본다.
 *
 * - 제품 앱(apps/web·worker·cli)과 어댑터 패키지의 시험 아닌 소스가 demo/ 나 @factory/core/testing 을 import 하지 않는다.
 * - 제품 앱의 package.json 이 @factory/demo 에 기대지 않는다.
 */

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const PRODUCT_DIRS = [
  "apps/web/src",
  "apps/worker/src",
  "apps/cli/src",
  "packages/codehost-github/src",
  "packages/runner-orca/src",
  "packages/tracker-linear/src",
  "packages/db/src",
];
const FORBIDDEN = [/@factory\/core\/testing/, /@factory\/demo/, /\bdemo\/src\b/];

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "fixtures") yield* sources(path);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      // 시험 도우미(test-support.ts, test-fixtures.ts)는 시험만 import 한다
      if (!entry.name.startsWith("test-")) yield path;
    }
  }
}

describe("개발 경로와 제품 코드의 경계", () => {
  it("제품 소스는 가짜 어댑터와 개발 진입점을 import 하지 않는다", () => {
    const offenders: string[] = [];
    for (const dir of PRODUCT_DIRS) {
      for (const file of sources(join(repoRoot, dir))) {
        const text = readFileSync(file, "utf8");
        for (const pattern of FORBIDDEN) {
          if (pattern.test(text)) offenders.push(`${relative(repoRoot, file)}: ${pattern.source}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("제품 앱은 @factory/demo 에 기대지 않는다", () => {
    for (const app of ["web", "worker", "cli"]) {
      const pkg = readFileSync(join(repoRoot, "apps", app, "package.json"), "utf8");
      expect([app, pkg.includes("@factory/demo")]).toEqual([app, false]);
    }
  });

  it("빌드 검사의 표시 문자열은 가짜 값을 잡는다", () => {
    expect(findDevMarkers(`const key = "${PREFILL["apiKey"]}";`)).toEqual(["lin_api_demo"]);
    expect(findDevMarkers("export const realAdapter = 1;")).toEqual([]);
  });
});

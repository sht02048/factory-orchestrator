import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { devOnlyMarkers } from "../../scripts/bundle-check.ts";
import { PREFILL } from "./values.js";

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

  it("제품 앱은 @ganger/demo 에 기대지 않는다", () => {
    for (const app of ["web", "worker", "cli"]) {
      const pkg = readFileSync(join(repoRoot, "apps", app, "package.json"), "utf8");
      expect([app, pkg.includes("@ganger/demo")]).toEqual([app, false]);
    }
  });

  it("배포물 검사의 개발 전용 문자열은 가짜 값을 잡는다", () => {
    expect(devOnlyMarkers(`const key = "${PREFILL["apiKey"]}";`)).toEqual(["lin_api_demo"]);
    expect(devOnlyMarkers("export const realAdapter = 1;")).toEqual([]);
  });
});

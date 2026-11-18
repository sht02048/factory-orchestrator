import { describe, expect, it } from "vitest";
import { buildMachinePaths, relativeBuildPaths, stripBuildRoot } from "./build-paths.ts";

const ROOT = "/srv/build/acme";

describe("stripBuildRoot", () => {
  it("turns absolute paths under the build root into repository-relative paths", () => {
    const source = `filePath: "${ROOT}/apps/web/src/routes/__root.tsx", other: "${ROOT}/x.ts"`;
    expect(stripBuildRoot(source, ROOT)).toBe(
      'filePath: "apps/web/src/routes/__root.tsx", other: "x.ts"',
    );
    expect(stripBuildRoot(source, `${ROOT}/`)).toBe(stripBuildRoot(source, ROOT));
  });

  it("leaves paths outside the build root alone", () => {
    expect(stripBuildRoot('"/srv/build/acme-other/a.ts"', ROOT)).toBe(
      '"/srv/build/acme-other/a.ts"',
    );
  });
});

describe("relativeBuildPaths", () => {
  it("rewrites rendered chunks that contain the build root and skips the rest", () => {
    const plugin = relativeBuildPaths(ROOT);
    expect(plugin.renderChunk(`"${ROOT}/a.ts"`, { fileName: "a.js" })).toEqual({
      code: '"a.ts"',
      map: null,
    });
    expect(plugin.renderChunk('"a.ts"', { fileName: "a.js" })).toBeNull();
  });
});

describe("buildMachinePaths", () => {
  it("finds the build root and home directory paths", () => {
    expect(buildMachinePaths(`"${ROOT}/apps/web/x.ts"`, [ROOT])).toEqual([ROOT]);
    expect(buildMachinePaths('"/Users/example/src/a.ts"')).toEqual(["/Users/example/"]);
    expect(buildMachinePaths('"/home/runner/work/a.ts"')).toEqual(["/home/runner/"]);
    expect(buildMachinePaths('"C:\\\\Users\\\\example\\\\a.ts"')).toEqual([
      "C:\\\\Users\\\\example\\",
    ]);
    expect(buildMachinePaths('"C:\\Users\\example\\a.ts"')).toEqual(["C:\\Users\\example\\"]);
  });

  it("passes relative paths and URL paths", () => {
    expect(
      buildMachinePaths('filePath: "apps/web/src/routes/__root.tsx"; fetch("/api/users/1")', [
        ROOT,
      ]),
    ).toEqual([]);
  });
});

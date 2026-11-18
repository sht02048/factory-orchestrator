import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeAdapterNames, findBundleProblems, packageImports } from "./bundle-check.ts";

describe("packageImports", () => {
  it("finds package imports and ignores relative paths and Node built-ins", () => {
    const source = [
      'import { a } from "./chunk.js";',
      'import { readFileSync } from "node:fs";',
      'import nodeHTTP, { IncomingMessage } from "node:http";',
      'import { z } from "zod";',
      'import {\n  jsx,\n  jsxs\n} from "react/jsx-runtime";',
      'export { b } from "../other.js";',
      'const m = await import("srvx/node");',
      'const s = __require("stream");',
      'const u = require("use-intl");',
    ].join("\n");
    expect(packageImports(source)).toEqual(["react/jsx-runtime", "srvx/node", "use-intl", "zod"]);
  });

  it("ignores module names inside strings that are not imports", () => {
    const source =
      'if (x) throw new Error(`requires (import { serve } from "srvx/node")`);\nconst s = "require";';
    expect(packageImports(source)).toEqual([]);
  });
});

describe("fakeAdapterNames", () => {
  it("finds the test fake adapters", () => {
    expect(
      fakeAdapterNames("class FakeRunner {}\nregistry.registerTracker(fakeTrackerFactory);"),
    ).toEqual(["FakeRunner", "fakeTrackerFactory"]);
    expect(fakeAdapterNames("class OrcaRunner {}")).toEqual([]);
  });
});

describe("findBundleProblems", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "factory-bundle-check-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(path: string, content: string): void {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }

  it("passes a bundle that only uses relative imports and built-ins", () => {
    write("cli/bin/cli.js", 'import { x } from "../chunk.js";\nimport fs from "node:fs";');
    write("web/client/app.css", "body {}");
    expect(findBundleProblems(dir)).toEqual([]);
  });

  it("reports node_modules, TypeScript sources, package imports, and fake adapters", () => {
    write("node_modules/zod/index.js", "");
    write("worker/src/main.ts", "");
    write("web/server/server.js", 'import { z } from "zod";');
    write("worker/server/main.js", "class FakeCodeHost {}");
    expect(findBundleProblems(dir).toSorted()).toEqual([
      "node_modules: node_modules must not be in the bundle",
      "web/server/server.js: imports packages zod",
      "worker/server/main.js: contains test fake adapters FakeCodeHost",
      "worker/src/main.ts: TypeScript source must not be in the bundle",
    ]);
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  devOnlyMarkers,
  ELECTRON_LICENSES,
  fakeAdapterNames,
  findAppProblems,
  findBundleProblems,
  NOTICE_FILE,
  packageImports,
} from "./bundle-check.ts";

const NOTICE = "Ganger includes the following third-party software.\n\nacme 1.0.0\nLicense: MIT\n";

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

  it("ignores require calls written as generated code in a template literal", () => {
    const source = [
      'const code = (0, codegen_1._)`require("ajv/dist/runtime/validation_error").default`;',
      'const formats = (0, codegen_1._)`require("ajv-formats/dist/formats").${name}`;',
      'const real = require("left-pad");',
    ].join("\n");
    expect(packageImports(source)).toEqual(["left-pad"]);
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

describe("devOnlyMarkers", () => {
  it("finds strings that only the pnpm dev entry point has", () => {
    expect(devOnlyMarkers('const key = "lin_api_demo_acme"; globalThis.__gangerDev;')).toEqual([
      "lin_api_demo",
      "__gangerDev",
    ]);
    expect(devOnlyMarkers('const key = "lin_api_real";')).toEqual([]);
  });
});

describe("findBundleProblems", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ganger-bundle-check-"));
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
    write(NOTICE_FILE, NOTICE);
    expect(findBundleProblems(dir)).toEqual([]);
  });

  it("reports a missing third-party license notice", () => {
    write("cli/bin/cli.js", "");
    expect(findBundleProblems(dir)).toEqual([`${NOTICE_FILE} is missing`]);
  });

  it("reports a third-party license notice that lists no packages", () => {
    write(NOTICE_FILE, "Ganger includes the following third-party software.\n");
    expect(findBundleProblems(dir)).toEqual([`${NOTICE_FILE} lists no packages`]);
  });

  it("reports absolute paths of the build machine in any text file", () => {
    write(NOTICE_FILE, NOTICE);
    write(
      "web/server/assets/manifest.js",
      'const routes = { __root__: { filePath: "/srv/build/acme/apps/web/src/routes/__root.tsx" } };',
    );
    write("web/client/app.css", "/* /home/runner/work/acme/a.css */");
    write("web/client/logo.png", "/Users/example/");
    expect(findBundleProblems(dir, ["/srv/build/acme"]).toSorted()).toEqual([
      "web/client/app.css: contains build machine paths /home/runner/",
      "web/server/assets/manifest.js: contains build machine paths /srv/build/acme",
    ]);
  });

  it("reports node_modules, TypeScript sources, package imports, and fake adapters", () => {
    write("node_modules/zod/index.js", "");
    write("worker/src/main.ts", "");
    write("web/server/server.js", 'import { z } from "zod";');
    write("worker/server/main.js", "class FakeCodeHost {}");
    expect(findBundleProblems(dir).toSorted()).toEqual([
      `${NOTICE_FILE} is missing`,
      "node_modules: node_modules must not be in the bundle",
      "web/server/server.js: imports packages zod",
      "worker/server/main.js: contains test fake adapters FakeCodeHost",
      "worker/src/main.ts: TypeScript source must not be in the bundle",
    ]);
  });
});

describe("findAppProblems", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ganger-app-check-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(path: string, content: string): void {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }

  it("passes app resources with notices, a clean app.asar, and a clean server bundle", () => {
    write(NOTICE_FILE, NOTICE);
    for (const name of ELECTRON_LICENSES) write(name, "");
    write("app.asar", "dist/main/main.js");
    write(`server/${NOTICE_FILE}`, NOTICE);
    write("server/cli/bin/cli.js", "");
    expect(findAppProblems(dir, ["/srv/build/acme"])).toEqual([]);
  });

  it("reports missing notices and build machine paths in app.asar and the server bundle", () => {
    write("app.asar", "\u0000/srv/build/acme/apps/desktop/src/main.ts\u0000");
    write("server/cli/bin/cli.js", '"/home/runner/work/a.ts"');
    expect(findAppProblems(dir, ["/srv/build/acme"])).toEqual([
      `${NOTICE_FILE} is missing`,
      "LICENSE.electron.txt is missing",
      "LICENSES.chromium.html is missing",
      "app.asar: contains build machine paths /srv/build/acme",
      `server/${NOTICE_FILE} is missing`,
      "server/cli/bin/cli.js: contains build machine paths /home/runner/",
    ]);
  });
});

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bundledPackages,
  copyleftKind,
  packageDirOf,
  readManifests,
  renderNotices,
  thirdPartyManifest,
} from "./third-party.ts";

describe("packageDirOf", () => {
  it("finds the package directory of a module inside node_modules", () => {
    expect(packageDirOf("/r/node_modules/.pnpm/react@19.3.1/node_modules/react/cjs/react.js")).toBe(
      "/r/node_modules/.pnpm/react@19.3.1/node_modules/react",
    );
    expect(
      packageDirOf("\0/r/node_modules/@tanstack/router-core/dist/esm/index.js?commonjs-proxy"),
    ).toBe("/r/node_modules/@tanstack/router-core");
  });

  it("ignores workspace sources and virtual modules", () => {
    expect(packageDirOf("/r/packages/core/src/index.ts")).toBeNull();
    expect(packageDirOf("\0vite/preload-helper.js")).toBeNull();
  });
});

describe("copyleftKind", () => {
  it("separates strong and weak copyleft licenses from permissive ones", () => {
    expect(copyleftKind("GPL-3.0-only")).toBe("strong");
    expect(copyleftKind("(MIT OR AGPL-3.0)")).toBe("strong");
    expect(copyleftKind("LGPL-2.1")).toBe("weak");
    expect(copyleftKind("MPL-2.0")).toBe("weak");
    expect(copyleftKind("MIT")).toBeNull();
    expect(copyleftKind("Apache-2.0")).toBeNull();
  });
});

describe("third-party notices", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ganger-third-party-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function addPackage(name: string, json: Record<string, unknown>, files: Record<string, string>) {
    const dir = join(root, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, ...json }));
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
    return dir;
  }

  it("lists each bundled package once with paths relative to the repository", () => {
    const acme = addPackage("acme", { version: "1.0.0", license: "MIT" }, {});
    const scoped = addPackage("@acme/ui", { version: "2.0.0", license: { type: "ISC" } }, {});
    expect(
      bundledPackages(
        [
          join(acme, "index.js"),
          join(acme, "lib", "a.js"),
          join(scoped, "dist", "index.js"),
          join(root, "packages", "core", "src", "index.ts"),
        ],
        root,
      ),
    ).toEqual([
      { name: "@acme/ui", version: "2.0.0", license: "ISC", dir: "node_modules/@acme/ui" },
      { name: "acme", version: "1.0.0", license: "MIT", dir: "node_modules/acme" },
    ]);
  });

  it("writes a manifest per build environment and merges them", () => {
    const acme = addPackage("acme", { version: "1.0.0", license: "MIT" }, {});
    const out = join(root, "dist", "third-party");
    const plugin = thirdPartyManifest(out, "web");
    const bundle = {
      "a.js": { type: "chunk", moduleIds: [join(acme, "index.js")] },
      "a.css": { type: "asset" },
    };
    plugin.writeBundle.call({ environment: { name: "client" } }, {}, bundle);
    plugin.writeBundle.call({ environment: { name: "ssr" } }, {}, bundle);
    expect(readdirSync(out).toSorted()).toEqual(["web-client.json", "web-ssr.json"]);
    const merged = readManifests([out]);
    expect(merged.map((pkg) => pkg.name)).toEqual(["acme"]);
    expect(merged.every((pkg) => !isAbsolute(pkg.dir))).toBe(true);
  });

  it("puts each license file and the source into the notice", () => {
    addPackage(
      "acme",
      { version: "1.0.0", license: "MIT", repository: { url: "git+https://example.com/acme.git" } },
      { LICENSE: "Copyright (c) Acme\n", "index.js": "" },
    );
    addPackage("bare", { version: "0.1.0", license: "Apache-2.0" }, {});
    const notice = renderNotices(
      "Ganger",
      [
        { name: "acme", version: "1.0.0", license: "MIT", dir: "node_modules/acme" },
        { name: "bare", version: "0.1.0", license: "Apache-2.0", dir: "node_modules/bare" },
      ],
      root,
    );
    expect(notice).toContain("acme 1.0.0\nLicense: MIT\nSource: https://example.com/acme");
    expect(notice).toContain("Copyright (c) Acme");
    expect(notice).toContain("bare 0.1.0\nLicense: Apache-2.0");
    expect(notice).toContain("Copyright (c) the bare authors.");
    expect(notice).toContain("Apache License\n                           Version 2.0");
  });

  it("uses the standard MIT text with the package author when no license file ships", () => {
    addPackage("plain", { version: "1.0.0", license: "MIT", author: { name: "Acme Inc." } }, {});
    const notice = renderNotices(
      "Ganger",
      [{ name: "plain", version: "1.0.0", license: "MIT", dir: "node_modules/plain" }],
      root,
    );
    expect(notice).toContain("Copyright (c) Acme Inc.");
    expect(notice).toContain("Permission is hereby granted, free of charge");
  });

  it("refuses a package with no license file and no standard text", () => {
    addPackage("odd", { version: "1.0.0", license: "SEE LICENSE IN EULA" }, {});
    expect(() =>
      renderNotices(
        "Ganger",
        [
          {
            name: "odd",
            version: "1.0.0",
            license: "SEE LICENSE IN EULA",
            dir: "node_modules/odd",
          },
        ],
        root,
      ),
    ).toThrow("odd@1.0.0 ships no license file");
  });
});

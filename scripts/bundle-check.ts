import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { basename, join, relative } from "node:path";
import { buildMachinePaths } from "./build-paths.ts";
import { REPO_ROOT } from "./third-party.ts";

export const NOTICE_FILE = "THIRD_PARTY_LICENSES.txt";

const FAKE_ADAPTER =
  /\b(?:Fake(?:Runner|Tracker|CodeHost)|fake(?:Runner|Tracker|CodeHost)Factory)\b/g;

export const DEV_ONLY_MARKERS = [
  "lin_api_demo",
  "github_pat_demo",
  "__gangerDev",
  "__gangerDemoWorld",
  "ganger-dev-adapters",
  "ganger-dev-tools",
  "가짜 값 채우기",
] as const;

const MODULE_REFERENCES = [
  /^(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm,
  /^import\s*["']([^"']+)["']/gm,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  /(?<!`)\b(?:__)?require\(\s*["']([^"']+)["']\s*\)/g,
];

const BUILTINS = new Set(builtinModules);

const TEXT_FILE = /\.(?:js|mjs|cjs|json|html|css|map|txt|sql)$/;

export function packageImports(source: string): string[] {
  const found = new Set<string>();
  for (const pattern of MODULE_REFERENCES) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (name === undefined || name.startsWith(".") || name.startsWith("/")) continue;
      if (name.startsWith("node:") || BUILTINS.has(name)) continue;
      found.add(name);
    }
  }
  return [...found].toSorted();
}

export function fakeAdapterNames(source: string): string[] {
  return [...new Set(source.match(FAKE_ADAPTER) ?? [])].toSorted();
}

export function devOnlyMarkers(source: string): string[] {
  return DEV_ONLY_MARKERS.filter((marker) => source.includes(marker));
}

export function noticeProblems(path: string): string[] {
  const name = basename(path);
  if (!existsSync(path)) return [`${name} is missing`];
  if (!readFileSync(path, "utf8").includes("\nLicense: ")) return [`${name} lists no packages`];
  return [];
}

export function findBundleProblems(
  root: string,
  buildRoots: readonly string[] = [REPO_ROOT],
): string[] {
  const problems: string[] = [];
  problems.push(...noticeProblems(join(root, NOTICE_FILE)));
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const shown = relative(root, path);
      if (entry.name === "node_modules") {
        problems.push(`${shown}: node_modules must not be in the bundle`);
        continue;
      }
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name)) {
        problems.push(`${shown}: TypeScript source must not be in the bundle`);
      }
      if (!TEXT_FILE.test(entry.name)) continue;
      const source = readFileSync(path, "utf8");
      const paths = buildMachinePaths(source, buildRoots);
      if (paths.length > 0) {
        problems.push(`${shown}: contains build machine paths ${paths.join(", ")}`);
      }
      if (!/\.(?:js|mjs|cjs)$/.test(entry.name)) continue;
      const imports = packageImports(source);
      if (imports.length > 0) problems.push(`${shown}: imports packages ${imports.join(", ")}`);
      const fakes = fakeAdapterNames(source);
      if (fakes.length > 0)
        problems.push(`${shown}: contains test fake adapters ${fakes.join(", ")}`);
      const dev = devOnlyMarkers(source);
      if (dev.length > 0) problems.push(`${shown}: contains dev-only code ${dev.join(", ")}`);
    }
  };
  walk(root);
  return problems;
}

export const ELECTRON_LICENSES = ["LICENSE.electron.txt", "LICENSES.chromium.html"] as const;

export function findAppProblems(
  resources: string,
  buildRoots: readonly string[] = [REPO_ROOT],
): string[] {
  const problems: string[] = [];
  problems.push(...noticeProblems(join(resources, NOTICE_FILE)));
  for (const name of ELECTRON_LICENSES) {
    if (!existsSync(join(resources, name))) problems.push(`${name} is missing`);
  }
  const asar = join(resources, "app.asar");
  if (existsSync(asar)) {
    const paths = buildMachinePaths(readFileSync(asar, "latin1"), buildRoots);
    if (paths.length > 0)
      problems.push(`app.asar: contains build machine paths ${paths.join(", ")}`);
  } else {
    problems.push("app.asar is missing");
  }
  const server = join(resources, "server");
  if (existsSync(server)) {
    problems.push(...findBundleProblems(server, buildRoots).map((line) => `server/${line}`));
  } else {
    problems.push("server is missing");
  }
  return problems;
}

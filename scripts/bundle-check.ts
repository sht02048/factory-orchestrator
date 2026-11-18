import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";

const FAKE_ADAPTER =
  /\b(?:Fake(?:Runner|Tracker|CodeHost)|fake(?:Runner|Tracker|CodeHost)Factory)\b/g;

export const DEV_ONLY_MARKERS = [
  "lin_api_demo",
  "github_pat_demo",
  "__factoryDev",
  "__factoryDemoWorld",
  "factory-dev-adapters",
  "factory-dev-tools",
  "가짜 값 채우기",
] as const;

const MODULE_REFERENCES = [
  /^(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm,
  /^import\s*["']([^"']+)["']/gm,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  /\b(?:__)?require\(\s*["']([^"']+)["']\s*\)/g,
];

const BUILTINS = new Set(builtinModules);

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

export function findBundleProblems(root: string): string[] {
  const problems: string[] = [];
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
      if (!/\.(?:js|mjs|cjs)$/.test(entry.name)) continue;
      const source = readFileSync(path, "utf8");
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

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { packageVersion as readPackageVersion } from "./release-plan.ts";

export { readPackageVersion };

const VERSION =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const TOP_LEVEL_VERSION = /^( {2}"version": ")([^"]*)(",?)$/m;

export const VERSIONED_PACKAGES = [
  "package.json",
  join("apps", "desktop", "package.json"),
] as const;

interface ParsedVersion {
  core: [number, number, number];
  pre: ReadonlyArray<string>;
}

export function isReleaseVersion(version: string): boolean {
  return VERSION.test(version);
}

function parse(version: string): ParsedVersion {
  const groups = VERSION.exec(version)?.groups;
  if (groups === undefined) {
    throw new Error(`${version} is not a release version like 1.2.3 or 1.2.3-rc.1`);
  }
  const pre = groups["pre"];
  return {
    core: [Number(groups["major"]), Number(groups["minor"]), Number(groups["patch"])],
    pre: pre === undefined ? [] : pre.split("."),
  };
}

function compareIdentifier(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  const core =
    left.core[0] - right.core[0] || left.core[1] - right.core[1] || left.core[2] - right.core[2];
  if (core !== 0) return Math.sign(core);
  if (left.pre.length === 0 || right.pre.length === 0) {
    return Math.sign(right.pre.length - left.pre.length);
  }
  for (let index = 0; index < Math.min(left.pre.length, right.pre.length); index += 1) {
    const order = compareIdentifier(left.pre[index] ?? "", right.pre[index] ?? "");
    if (order !== 0) return Math.sign(order);
  }
  return Math.sign(left.pre.length - right.pre.length);
}

export function assertVersionBump(current: string, next: string): void {
  parse(next);
  if (compareVersions(next, current) <= 0) {
    throw new Error(`${next} is not higher than the current version ${current}`);
  }
}

export function withPackageVersion(json: string, path: string, version: string): string {
  if (!TOP_LEVEL_VERSION.test(json)) throw new Error(`${path} has no top-level version line`);
  const updated = json.replace(TOP_LEVEL_VERSION, `$1${version}$3`);
  if (readPackageVersion(updated, path) !== version) {
    throw new Error(`${path} version did not change to ${version}`);
  }
  return updated;
}

export function bumpVersions(root: string, next: string): string {
  const files = VERSIONED_PACKAGES.map((path) => {
    const json = readFileSync(join(root, path), "utf8");
    return { path, json, version: readPackageVersion(json, path) };
  });
  const [first] = files;
  if (first === undefined) throw new Error("no versioned packages");
  for (const file of files) {
    if (file.version !== first.version) {
      throw new Error(
        `${file.path} version ${file.version} differs from ${first.path} version ${first.version}`,
      );
    }
  }
  assertVersionBump(first.version, next);
  for (const file of files) {
    writeFileSync(join(root, file.path), withPackageVersion(file.json, file.path, next));
  }
  return first.version;
}

function main(argv: ReadonlyArray<string>): number {
  const [command, next] = argv;
  if (command !== "bump" || next === undefined) {
    console.error("usage: node scripts/release-version.ts bump <version>");
    return 2;
  }
  const root = fileURLToPath(new URL("..", import.meta.url));
  try {
    const previous = bumpVersions(root, next);
    console.log(`${previous} -> ${next}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_TAG = /^v(?<version>(?<core>\d+\.\d+\.\d+)(?:-(?<pre>[0-9A-Za-z.-]+))?)$/;

export interface ReleasePlan {
  version: string;
  prerelease: boolean;
  notesStartTag: string | null;
}

export interface ReleasePlanInput {
  tag: string;
  rootVersion: string;
  desktopVersion: string;
  tags: ReadonlyArray<string>;
}

function stableCore(tag: string): [number, number, number] | null {
  const match = RELEASE_TAG.exec(tag);
  if (match?.groups?.["pre"] !== undefined) return null;
  const core = match?.groups?.["core"];
  if (core === undefined) return null;
  const [major = 0, minor = 0, patch = 0] = core.split(".").map(Number);
  return [major, minor, patch];
}

function compareCore(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function previousStableTag(tag: string, tags: ReadonlyArray<string>): string | null {
  const current = stableCore(tag);
  if (current === null) return null;
  let best: { tag: string; core: [number, number, number] } | null = null;
  for (const candidate of tags) {
    const core = stableCore(candidate);
    if (core === null || compareCore(core, current) >= 0) continue;
    if (best === null || compareCore(core, best.core) > 0) best = { tag: candidate, core };
  }
  return best?.tag ?? null;
}

export function releasePlan(input: ReleasePlanInput): ReleasePlan {
  const match = RELEASE_TAG.exec(input.tag);
  const version = match?.groups?.["version"];
  if (version === undefined) {
    throw new Error(`${input.tag} is not a release tag like v1.2.3 or v1.2.3-rc.1`);
  }
  for (const [where, declared] of [
    ["package.json", input.rootVersion],
    ["apps/desktop/package.json", input.desktopVersion],
  ] as const) {
    if (declared !== version) {
      throw new Error(`${input.tag} does not match ${where} version ${declared}`);
    }
  }
  const prerelease = match?.groups?.["pre"] !== undefined;
  return {
    version,
    prerelease,
    notesStartTag: prerelease ? null : previousStableTag(input.tag, input.tags),
  };
}

export function packageVersion(json: string, path: string): string {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
    const { version } = parsed;
    if (typeof version === "string") return version;
  }
  throw new Error(`${path} has no version`);
}

function git(root: string, args: ReadonlyArray<string>): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function isOnMain(root: string, commit: string): boolean {
  try {
    git(root, ["merge-base", "--is-ancestor", commit, "origin/main"]);
    return true;
  } catch {
    return false;
  }
}

function main(): number {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const tag = process.env["GITHUB_REF_NAME"] ?? "";
  const commit = git(root, ["rev-parse", "HEAD^{commit}"]).trim();
  if (!isOnMain(root, commit)) {
    console.error(`${tag} points at ${commit}, which is not on origin/main.`);
    return 1;
  }
  let plan: ReleasePlan;
  try {
    const readVersion = (path: string): string =>
      packageVersion(readFileSync(join(root, path), "utf8"), path);
    plan = releasePlan({
      tag,
      rootVersion: readVersion("package.json"),
      desktopVersion: readVersion(join("apps", "desktop", "package.json")),
      tags: git(root, ["tag", "--list", "v*"]).split("\n").filter(Boolean),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const outputs = [
    `version=${plan.version}`,
    `prerelease=${String(plan.prerelease)}`,
    `notes-start-tag=${plan.notesStartTag ?? ""}`,
  ];
  console.log(outputs.join("\n"));
  const outputFile = process.env["GITHUB_OUTPUT"];
  if (outputFile !== undefined) appendFileSync(outputFile, `${outputs.join("\n")}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  VERSIONED_PACKAGES,
  compareVersions,
  isReleaseVersion,
  readPackageVersion,
} from "./release-version.ts";

export interface PackageVersions {
  root: string;
  desktop: string;
}

export type TagDecision =
  | { kind: "none"; reason: string }
  | { kind: "tag"; tag: string; version: string };

export function tagDecision(before: PackageVersions | null, after: PackageVersions): TagDecision {
  if (before === null) {
    return { kind: "none", reason: "the previous commit is not available to compare" };
  }
  if (before.root === after.root && before.desktop === after.desktop) {
    return { kind: "none", reason: `the version is still ${after.root}` };
  }
  if (after.root !== after.desktop) {
    throw new Error(
      `package.json version ${after.root} and apps/desktop/package.json version ${after.desktop} differ`,
    );
  }
  if (!isReleaseVersion(after.root)) {
    throw new Error(`${after.root} is not a release version like 1.2.3 or 1.2.3-rc.1`);
  }
  if (isReleaseVersion(before.root) && compareVersions(after.root, before.root) <= 0) {
    throw new Error(`${after.root} is not higher than the previous version ${before.root}`);
  }
  return { kind: "tag", tag: `v${after.root}`, version: after.root };
}

export type ExistingTagAction = "create" | "skip";

export function existingTagAction(
  tag: string,
  existingCommit: string | null,
  commit: string,
): ExistingTagAction {
  if (existingCommit === null) return "create";
  if (existingCommit === commit) return "skip";
  throw new Error(`${tag} already points at ${existingCommit}, not ${commit}`);
}

function git(root: string, args: ReadonlyArray<string>): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function versionsAt(root: string, commit: string): PackageVersions {
  const [rootPath, desktopPath] = VERSIONED_PACKAGES;
  const read = (path: string): string =>
    readPackageVersion(git(root, ["show", `${commit}:${path}`]), path);
  return { root: read(rootPath), desktop: read(desktopPath) };
}

function commitExists(root: string, commit: string): boolean {
  if (!/^[0-9a-f]{40}$/.test(commit) || /^0+$/.test(commit)) return false;
  try {
    git(root, ["cat-file", "-e", `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function remoteTagCommit(root: string, tag: string): string | null {
  const lines = git(root, [
    "ls-remote",
    "--tags",
    "origin",
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));
  const peeled = lines.find(([, ref]) => ref === `refs/tags/${tag}^{}`);
  const direct = lines.find(([, ref]) => ref === `refs/tags/${tag}`);
  return (peeled ?? direct)?.[0] ?? null;
}

function main(): number {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const before = process.env["BEFORE_SHA"] ?? "";
  const commit = git(root, ["rev-parse", "HEAD^{commit}"]).trim();
  let outputs: string[];
  try {
    const decision = tagDecision(
      commitExists(root, before) ? versionsAt(root, before) : null,
      versionsAt(root, commit),
    );
    if (decision.kind === "none") {
      console.log(`No release tag: ${decision.reason}.`);
      outputs = ["tag=", `commit=${commit}`];
    } else if (
      existingTagAction(decision.tag, remoteTagCommit(root, decision.tag), commit) === "skip"
    ) {
      console.log(`${decision.tag} already points at ${commit}; nothing to do.`);
      outputs = ["tag=", `commit=${commit}`];
    } else {
      console.log(`Create ${decision.tag} at ${commit}.`);
      outputs = [`tag=${decision.tag}`, `commit=${commit}`];
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const outputFile = process.env["GITHUB_OUTPUT"];
  if (outputFile !== undefined) appendFileSync(outputFile, `${outputs.join("\n")}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}

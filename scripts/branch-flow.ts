import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEVELOP_BRANCH = "develop";
export const MAIN_BRANCH = "main";

const BRANCH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type ReleaseSource = { kind: "develop" } | { kind: "hotfix"; branch: string };

function isSafeBranchUnder(prefix: string, branch: string): boolean {
  if (!branch.startsWith(`${prefix}/`)) return false;
  const segments = branch.slice(prefix.length + 1).split("/");
  return segments.every(
    (segment) =>
      BRANCH_SEGMENT.test(segment) && !segment.includes("..") && !segment.endsWith(".lock"),
  );
}

export function releaseSource(source: string): ReleaseSource {
  if (source === DEVELOP_BRANCH) return { kind: "develop" };
  if (isSafeBranchUnder("hotfix", source)) return { kind: "hotfix", branch: source };
  throw new Error(
    `Prepare release takes ${DEVELOP_BRANCH} or a hotfix/* branch as its source, not "${source}"`,
  );
}

export interface MainPullRequest {
  baseRef: string;
  headRef: string;
  sameRepository: boolean;
  developExists: boolean;
  headContainsMain: boolean;
}

export type MainPullRequestVerdict =
  | { kind: "skip"; reason: string }
  | { kind: "pass"; reason: string }
  | { kind: "fail"; reason: string };

export function mainPullRequestVerdict(pr: MainPullRequest): MainPullRequestVerdict {
  if (pr.baseRef !== MAIN_BRANCH) {
    return { kind: "skip", reason: `the pull request goes to ${pr.baseRef}, not ${MAIN_BRANCH}` };
  }
  if (!pr.developExists) {
    return { kind: "skip", reason: `the ${DEVELOP_BRANCH} branch does not exist yet` };
  }
  const allowed =
    isSafeBranchUnder("release", pr.headRef) || isSafeBranchUnder("hotfix", pr.headRef);
  if (!pr.sameRepository || !allowed) {
    return {
      kind: "fail",
      reason: `pull requests to ${MAIN_BRANCH} come only from release/* or hotfix/* branches of this repository, not ${pr.sameRepository ? "" : "a fork's "}${pr.headRef}. Open feature work against ${DEVELOP_BRANCH}`,
    };
  }
  if (!pr.headContainsMain) {
    return {
      kind: "fail",
      reason: `${pr.headRef} does not contain the latest ${MAIN_BRANCH}. Merge ${MAIN_BRANCH} into it so this pull request does not undo a hotfix`,
    };
  }
  return { kind: "pass", reason: `${pr.headRef} contains the latest ${MAIN_BRANCH}` };
}

function git(root: string, args: ReadonlyArray<string>): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function remoteBranchExists(root: string, branch: string): boolean {
  return git(root, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).trim() !== "";
}

function isAncestor(root: string, ancestor: string, descendant: string): boolean {
  try {
    git(root, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function checkMainPullRequest(root: string): MainPullRequestVerdict {
  const baseRef = requiredEnv("BASE_REF");
  if (baseRef !== MAIN_BRANCH) {
    return mainPullRequestVerdict({
      baseRef,
      headRef: requiredEnv("HEAD_REF"),
      sameRepository: true,
      developExists: false,
      headContainsMain: false,
    });
  }
  const developExists = remoteBranchExists(root, DEVELOP_BRANCH);
  let headContainsMain = false;
  if (developExists) {
    git(root, [
      "fetch",
      "--no-tags",
      "origin",
      `+refs/heads/${MAIN_BRANCH}:refs/remotes/origin/${MAIN_BRANCH}`,
    ]);
    headContainsMain = isAncestor(
      root,
      `refs/remotes/origin/${MAIN_BRANCH}`,
      requiredEnv("HEAD_SHA"),
    );
  }
  return mainPullRequestVerdict({
    baseRef,
    headRef: requiredEnv("HEAD_REF"),
    sameRepository: requiredEnv("HEAD_REPOSITORY") === requiredEnv("REPOSITORY"),
    developExists,
    headContainsMain,
  });
}

function main(argv: ReadonlyArray<string>): number {
  const [command, argument] = argv;
  const root = fileURLToPath(new URL("..", import.meta.url));
  try {
    if (command === "release-source" && argument !== undefined) {
      const source = releaseSource(argument);
      const outputs = [`kind=${source.kind}`, `branch=${argument}`];
      console.log(`Source ${argument} is a ${source.kind} source.`);
      const outputFile = process.env["GITHUB_OUTPUT"];
      if (outputFile !== undefined) appendFileSync(outputFile, `${outputs.join("\n")}\n`);
      return 0;
    }
    if (command === "main-pr" && argument === undefined) {
      const verdict = checkMainPullRequest(root);
      if (verdict.kind === "fail") {
        console.log(`::error::${verdict.reason}.`);
        return 1;
      }
      console.log(`${verdict.kind === "skip" ? "Skipped" : "Passed"}: ${verdict.reason}.`);
      return 0;
    }
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}.`);
    return 1;
  }
  console.error("usage: node scripts/branch-flow.ts release-source <source> | main-pr");
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

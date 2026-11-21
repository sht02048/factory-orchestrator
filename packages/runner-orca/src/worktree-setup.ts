import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { RemoteResult } from "./ssh.js";

const SETUP_MARKER_DIR = "ganger-setup-pending";
const FAILURE_OUTPUT_CHARS = 2000;
const KNOWN_SOURCE_POLICIES = new Set(["local-only", "shared-only", "run-both"]);
export const SETUP_ALREADY_RUNNING_EXIT = 75;
export const SETUP_SSH_GRACE_MS = 15_000;

const RUN_SETUP_SCRIPT = `cd "$ORCA_WORKTREE_PATH" || exit 1
lock=$2
if [ -f "$lock" ] && kill -0 "$(cat "$lock")" 2>/dev/null; then exit ${String(SETUP_ALREADY_RUNNING_EXIT)}; fi
echo $$ > "$lock"
trap 'rm -f "$lock"' EXIT
set -m
"\${SHELL:-/bin/sh}" -lc 'exec bash -ec "$1"' ganger-setup "$1" </dev/null &
job=$!
set +m
(
  i=0
  while [ "$i" -lt "$3" ]; do
    sleep 1
    kill -0 "$job" 2>/dev/null || exit 0
    i=$((i + 1))
  done
  kill -TERM -- "-$job" 2>/dev/null
  sleep 5
  kill -KILL -- "-$job" 2>/dev/null
) </dev/null >/dev/null 2>&1 &
wait "$job"
exit $?`;

export function gitCommonDirArgv(repoPath: string): string[] {
  return ["git", "-C", repoPath, "rev-parse", "--path-format=absolute", "--git-common-dir"];
}

export function setupMarkerPath(commonDir: string, worktreePath: string): string {
  const key = createHash("sha256").update(worktreePath).digest("hex").slice(0, 32);
  return `${commonDir.trim()}/${SETUP_MARKER_DIR}/${key}`;
}

export function setupMarkerDirArgv(marker: string): string[] {
  return ["mkdir", "-p", marker.slice(0, marker.lastIndexOf("/"))];
}

export function markSetupPendingArgv(marker: string): string[] {
  return ["touch", marker];
}

export function setupPendingArgv(marker: string): string[] {
  return ["test", "-e", marker];
}

export function clearSetupPendingArgv(marker: string): string[] {
  return ["rm", "-f", marker];
}

export function readOrcaYamlArgv(path: string): string[] {
  return ["sh", "-c", '[ ! -e "$1" ] || cat "$1"', "sh", `${path}/orca.yaml`];
}

export function runSetupArgv(input: {
  rootPath: string;
  worktreePath: string;
  script: string;
  lock: string;
  limitSeconds: number;
}): string[] {
  const { rootPath, worktreePath, script, lock, limitSeconds } = input;
  return [
    "env",
    `ORCA_ROOT_PATH=${rootPath}`,
    `ORCA_WORKTREE_PATH=${worktreePath}`,
    `ORCA_WORKSPACE_NAME=${basename(worktreePath)}`,
    `CONDUCTOR_ROOT_PATH=${rootPath}`,
    `GHOSTX_ROOT_PATH=${rootPath}`,
    "sh",
    "-c",
    RUN_SETUP_SCRIPT,
    "ganger-setup",
    script,
    lock,
    String(limitSeconds),
  ];
}

export type SharedSetup = { kind: "found"; script: string | null } | { kind: "unreadable" };

const UNREADABLE: SharedSetup = { kind: "unreadable" };

export function parseSharedSetup(yaml: string): SharedSetup {
  const lines = yaml.replaceAll("\r\n", "\n").split("\n");
  const scriptsAt = lines.findIndex((line) => /^["']?scripts["']?\s*:/.test(line));
  if (scriptsAt === -1) return { kind: "found", script: null };
  if (!/^scripts:\s*(#.*)?$/.test(lines[scriptsAt] ?? "")) return UNREADABLE;

  const section: string[] = [];
  for (const line of lines.slice(scriptsAt + 1)) {
    if (line.trim() !== "" && !/^\s/.test(line) && !line.startsWith("#")) break;
    section.push(line);
  }
  const firstKey = section.find(isContent);
  if (firstKey === undefined) return { kind: "found", script: null };
  const keyIndent = indentOf(firstKey);
  const keys = section.filter((line) => isContent(line) && indentOf(line) === keyIndent);
  if (keys.some((line) => /^\s*["']setup["']\s*:/.test(line))) return UNREADABLE;
  const setupAt = section.findIndex(
    (line) => indentOf(line) === keyIndent && /^\s*setup\s*:/.test(line),
  );
  if (setupAt === -1) return { kind: "found", script: null };

  const after = section.slice(setupAt + 1);
  const value = (section[setupAt] ?? "").replace(/^\s*setup\s*:\s*/, "");
  if (/^\|[-+]?\s*(#.*)?$/.test(value)) {
    return { kind: "found", script: blockScalar(after, keyIndent) };
  }
  const next = after.find(isContent);
  if (next !== undefined && indentOf(next) > keyIndent) return UNREADABLE;
  return inlineScalar(value);
}

function isContent(line: string): boolean {
  return line.trim() !== "" && !line.trim().startsWith("#");
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function blockScalar(lines: ReadonlyArray<string>, keyIndent: number): string | null {
  const body: string[] = [];
  for (const line of lines) {
    if (line.trim() !== "" && indentOf(line) <= keyIndent) break;
    body.push(line);
  }
  const first = body.find((line) => line.trim() !== "");
  if (first === undefined) return null;
  const blockIndent = indentOf(first);
  const script = body.map((line) => line.slice(blockIndent)).join("\n");
  return script.trim() === "" ? null : script.trim();
}

function inlineScalar(value: string): SharedSetup {
  const text = value.trim();
  if (text === "" || text.startsWith("#")) return { kind: "found", script: null };
  if (text.startsWith("'")) {
    const quoted = /^'((?:[^']|'')*)'\s*(#.*)?$/.exec(text);
    return quoted === null
      ? UNREADABLE
      : { kind: "found", script: (quoted[1] ?? "").replaceAll("''", "'") };
  }
  if (text.startsWith('"')) {
    const quoted = /^"([^"\\]*)"\s*(#.*)?$/.exec(text);
    return quoted === null ? UNREADABLE : { kind: "found", script: quoted[1] ?? "" };
  }
  if (/^[|>&*!{[]/.test(text)) return UNREADABLE;
  return { kind: "found", script: text.replace(/\s+#.*$/, "") };
}

export function isKnownSetupPolicy(policy: string | null | undefined): boolean {
  return policy === null || policy === undefined || KNOWN_SOURCE_POLICIES.has(policy);
}

export function effectiveSetupScript(input: {
  policy: string | null | undefined;
  local: string | null | undefined;
  shared: string | null;
}): string | null {
  const local = input.local?.trim() ?? "";
  const shared = input.shared?.trim() ?? "";
  const policy = input.policy ?? (local === "" ? "shared-only" : "local-only");
  const parts =
    policy === "local-only" ? [local] : policy === "run-both" ? [shared, local] : [shared];
  const script = parts.filter((part) => part !== "").join("\n\n");
  return script === "" ? null : script;
}

export function setupFailureReason(result: RemoteResult): string {
  if (result.exitCode === SETUP_ALREADY_RUNNING_EXIT) return "setup is already running";
  const output = `${result.stdout}\n${result.stderr}`.trim().slice(-FAILURE_OUTPUT_CHARS);
  const head = result.timedOut ? "setup timed out" : `setup exited with ${String(result.exitCode)}`;
  return output === "" ? head : `${head}\n${output}`;
}

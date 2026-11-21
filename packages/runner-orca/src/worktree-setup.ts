import { basename } from "node:path";
import type { RemoteResult } from "./ssh.js";

const SETUP_MARKER = "ganger-setup-pending";
const FAILURE_OUTPUT_CHARS = 2000;
const RUN_SETUP_SCRIPT =
  'cd "$ORCA_WORKTREE_PATH" && exec "${SHELL:-/bin/sh}" -lc \'exec bash -ec "$1"\' ganger-setup "$1"';

export function worktreeAdminDirArgv(path: string): string[] {
  return ["git", "-C", path, "rev-parse", "--absolute-git-dir"];
}

export function setupMarkerPath(adminDir: string): string {
  return `${adminDir.trim()}/${SETUP_MARKER}`;
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
}): string[] {
  const { rootPath, worktreePath, script } = input;
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
  ];
}

export type SharedSetup = { kind: "found"; script: string | null } | { kind: "unreadable" };

export function parseSharedSetup(yaml: string): SharedSetup {
  const lines = yaml.replaceAll("\r\n", "\n").split("\n");
  const scriptsAt = lines.findIndex((line) => /^scripts:\s*(#.*)?$/.test(line));
  if (scriptsAt === -1) return { kind: "found", script: null };

  const section: string[] = [];
  for (const line of lines.slice(scriptsAt + 1)) {
    if (line.trim() !== "" && !/^\s/.test(line) && !line.startsWith("#")) break;
    section.push(line);
  }
  const firstKey = section.find((line) => line.trim() !== "" && !line.trim().startsWith("#"));
  if (firstKey === undefined) return { kind: "found", script: null };
  const keyIndent = indentOf(firstKey);
  const setupAt = section.findIndex(
    (line) => indentOf(line) === keyIndent && /^\s*setup\s*:/.test(line),
  );
  if (setupAt === -1) return { kind: "found", script: null };

  const value = (section[setupAt] ?? "").replace(/^\s*setup\s*:\s*/, "");
  if (/^\|[-+]?\s*(#.*)?$/.test(value)) {
    return { kind: "found", script: blockScalar(section.slice(setupAt + 1), keyIndent) };
  }
  return inlineScalar(value);
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
      ? { kind: "unreadable" }
      : { kind: "found", script: (quoted[1] ?? "").replaceAll("''", "'") };
  }
  if (text.startsWith('"')) {
    const quoted = /^"([^"\\]*)"\s*(#.*)?$/.exec(text);
    return quoted === null ? { kind: "unreadable" } : { kind: "found", script: quoted[1] ?? "" };
  }
  if (/^[>&*!{[]/.test(text)) return { kind: "unreadable" };
  return { kind: "found", script: text.replace(/\s+#.*$/, "") };
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
  const output = `${result.stdout}\n${result.stderr}`.trim().slice(-FAILURE_OUTPUT_CHARS);
  const head = result.timedOut ? "setup timed out" : `setup exited with ${String(result.exitCode)}`;
  return output === "" ? head : `${head}\n${output}`;
}

import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  stdin?: string;
  timeoutMs?: number;
}

export type CommandRunner = (
  command: string,
  args: ReadonlyArray<string>,
  options?: CommandOptions,
) => Promise<CommandResult>;

const DEFAULT_TIMEOUT_MS = 60_000;
const OUTPUT_LIMIT = 64 * 1024;

export const runCommand: CommandRunner = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout: "", stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdout).toString("utf8").slice(0, OUTPUT_LIMIT),
        stderr: Buffer.concat(stderr).toString("utf8").slice(0, OUTPUT_LIMIT),
      });
    });
    child.stdin.end(options.stdin ?? "");
  });

const DETAIL_LIMIT = 300;

export function failureDetail(result: CommandResult, secrets: ReadonlyArray<string> = []): string {
  const text = (result.stderr.trim() === "" ? result.stdout : result.stderr).trim();
  const redacted = secrets
    .filter((secret) => secret.length > 0)
    .reduce((acc, secret) => acc.replaceAll(secret, "***"), text);
  const firstLines = redacted.split("\n").slice(0, 3).join(" ").trim();
  if (firstLines === "")
    return result.exitCode === null ? "did not finish" : `exit ${result.exitCode}`;
  return firstLines.length > DETAIL_LIMIT ? `${firstLines.slice(0, DETAIL_LIMIT)}…` : firstLines;
}

import { spawn } from "node:child_process";

export interface RemoteResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RemoteRunOptions {
  stdin?: string;
  timeoutMs: number;
}

export interface RemoteExec {
  run(command: string, options: RemoteRunOptions): Promise<RemoteResult>;
}

export interface SshIdentity {
  identityFile: string;
  knownHostsFile: string;
}

function sshPathValue(path: string): string {
  return `"${path.replaceAll("%", "%%")}"`;
}

export function sshArgs(input: {
  sshTarget: string;
  connectTimeoutSeconds: number;
  access?: SshIdentity | undefined;
}): string[] {
  const identity =
    input.access === undefined
      ? []
      : [
          "-i",
          input.access.identityFile.replaceAll("%", "%%"),
          "-o",
          "IdentitiesOnly=yes",
          "-o",
          `UserKnownHostsFile=${sshPathValue(input.access.knownHostsFile)}`,
          "-o",
          "StrictHostKeyChecking=yes",
        ];
  return [
    ...identity,
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${input.connectTimeoutSeconds}`,
    "-T",
    "--",
    input.sshTarget,
  ];
}

export function sshExec(input: {
  sshTarget: string;
  connectTimeoutSeconds: number;
  access?: SshIdentity | undefined;
}): RemoteExec {
  const baseArgs = sshArgs(input);
  return {
    run(command, options) {
      return new Promise<RemoteResult>((resolve, reject) => {
        const child = spawn("ssh", [...baseArgs, command], { stdio: ["pipe", "pipe", "pipe"] });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, options.timeoutMs);
        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.stdin.on("error", () => undefined);
        child.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({
            exitCode: code,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
            timedOut,
          });
        });
        child.stdin.end(options.stdin ?? "");
      });
    },
  };
}

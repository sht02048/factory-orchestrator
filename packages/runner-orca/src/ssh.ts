import { spawn } from "node:child_process";

/** 원격 명령 하나의 결과. 종료 코드가 아니라 stdout JSON으로 판단하는 것은 부르는 쪽이 한다. */
export interface RemoteResult {
  /** 프로세스 종료 코드. 신호로 끝났으면 null */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** 제한 시간을 넘겨 끊었음 */
  timedOut: boolean;
}

export interface RemoteRunOptions {
  /** 원격 명령의 stdin으로 보낼 값. 없으면 stdin을 바로 닫는다 */
  stdin?: string;
  timeoutMs: number;
}

/**
 * 러너에서 원격 명령 문자열 하나를 돌린다. 테스트는 이 인터페이스를 가짜로 바꿔 보낸 명령을 기록한다.
 * 명령 문자열은 shell.ts의 toRemoteCommand로만 만든다.
 */
export interface RemoteExec {
  run(command: string, options: RemoteRunOptions): Promise<RemoteResult>;
}

/** 로컬 `ssh`로 원격 명령을 돌린다. 비밀번호·호스트 키 질문으로 멈추지 않게 BatchMode를 켠다. */
export function sshExec(input: { sshTarget: string; connectTimeoutSeconds: number }): RemoteExec {
  const baseArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${input.connectTimeoutSeconds}`,
    "-T",
    input.sshTarget,
  ];
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
        // 원격이 stdin을 다 읽기 전에 끝나면 EPIPE가 난다. 결과는 종료 코드와 출력으로 판단한다.
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

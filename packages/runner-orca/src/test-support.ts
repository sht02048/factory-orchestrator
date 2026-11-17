import { readFileSync } from "node:fs";
import { DEFAULT_ORCA_PATH, parseOrcaRunnerConfig } from "./config.js";
import { OrcaRunner } from "./orca-runner.js";
import type { RemoteExec, RemoteResult, RemoteRunOptions } from "./ssh.js";

/**
 * 테스트용. 러너에서 받은 실제 출력(픽스처)을 돌려주는 가짜 ssh와 그 출력을 읽는 함수.
 * - `own`: 이 티켓이 테스트 러너에서 새로 받은 출력(`packages/runner-orca/fixtures/`)
 * - `research`: research 0003·0004·0008의 픽스처(`docs/research/fixtures/`). 폴더끼리 가상 ID가 달라 한 테스트에
 *   섞지 않는다.
 */
export function own(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

export function research(name: string): string {
  return readFileSync(new URL(`../../../docs/research/fixtures/${name}`, import.meta.url), "utf8");
}

/** orca가 JSON을 내고 끝난 결과 */
export function stdout(text: string, exitCode = 0): RemoteResult {
  return { exitCode, stdout: text, stderr: "", timedOut: false };
}

/** 픽스처에 저장한 프로세스 결과(`{ exitCode, stdout, stderr }`) */
export function processResult(text: string): RemoteResult {
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("exitCode" in parsed) ||
    !("stdout" in parsed) ||
    !("stderr" in parsed) ||
    typeof parsed.exitCode !== "number" ||
    typeof parsed.stdout !== "string" ||
    typeof parsed.stderr !== "string"
  ) {
    throw new TypeError("not a process result fixture");
  }
  return {
    exitCode: parsed.exitCode,
    stdout: parsed.stdout,
    stderr: parsed.stderr,
    timedOut: false,
  };
}

/** research 0008의 `--full` 메일 행 하나를 `check --peek --full` 봉투로 감싼다 */
export function peekOf(...rows: string[]): string {
  const messages: unknown[] = rows.map((row) => {
    const parsed: unknown = JSON.parse(row);
    return parsed;
  });
  return JSON.stringify({ ok: true, result: { messages } });
}

export interface RecordedCall {
  command: string;
  stdin: string | undefined;
}

type Reply = RemoteResult | (() => RemoteResult);

/**
 * 명령 앞부분으로 결과를 고르는 가짜 ssh. orca 명령은 `orca` 경로 뒤의 인자로, 그 밖의 명령은 명령 전체의
 * 앞부분으로 고른다. 같은 앞부분을 여러 번 등록하면 차례로 쓰고 마지막 것을 되풀이한다.
 */
export class ScriptedExec implements RemoteExec {
  readonly calls: RecordedCall[] = [];
  private readonly routes: Array<{ prefix: string; replies: Reply[] }> = [];

  /** `orca <args>`로 시작하는 명령의 결과 */
  orca(args: string, ...replies: Reply[]): this {
    return this.on(`${DEFAULT_ORCA_PATH} ${args}`, ...replies);
  }

  on(prefix: string, ...replies: Reply[]): this {
    this.routes.push({ prefix, replies });
    return this;
  }

  run(command: string, options: RemoteRunOptions): Promise<RemoteResult> {
    this.calls.push({ command, stdin: options.stdin });
    const route = this.routes
      .filter((r) => command.startsWith(r.prefix))
      .sort((a, b) => b.prefix.length - a.prefix.length)[0];
    if (route === undefined) return Promise.reject(new Error(`unexpected command: ${command}`));
    const reply = route.replies.length > 1 ? route.replies.shift() : route.replies[0];
    if (reply === undefined) return Promise.reject(new Error(`no reply for: ${command}`));
    return Promise.resolve(typeof reply === "function" ? reply() : reply);
  }

  commands(): string[] {
    return this.calls.map((call) => call.command);
  }
}

export function runnerWith(exec: ScriptedExec): OrcaRunner {
  return new OrcaRunner(parseOrcaRunnerConfig({ sshTarget: "runner.example.com" }), exec);
}

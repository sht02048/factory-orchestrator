import type { WorkerReadResult } from "./schemas.js";

/**
 * `worker-read` 한 쪽을 화면에 보일 줄로 바꾼다. 출력은 둘 중 하나다(fixtures/worker-read-*.json).
 * - `source: "transcript"`: 에이전트 대화 기록. 메시지마다 `[역할]` 머리를 붙이고 본문을 줄로 나눈다.
 * - `source: "terminal"`: 터미널 출력 줄(`terminal.tail`). 그대로 쓴다.
 */
export function workerReadLines(result: WorkerReadResult): string[] {
  if (result.transcript !== null && result.transcript !== undefined) {
    return result.transcript.messages.flatMap((message) =>
      message.blocks.flatMap((block) => blockLines(message.role, block)),
    );
  }
  return [...(result.terminal?.tail ?? [])];
}

type Block = NonNullable<WorkerReadResult["transcript"]>["messages"][number]["blocks"][number];

function blockLines(role: string, block: Block): string[] {
  switch (block.type) {
    case "text":
      return prefixed(`[${role}]`, block.text ?? "");
    case "tool-call":
      return prefixed(`[${role}] ${block.name ?? "tool"}:`, stringify(block.input));
    case "tool-result":
      return prefixed(`[${role}]`, stringify(block.output));
    default:
      return prefixed(`[${role}] ${block.type}:`, block.text ?? stringify(block.input));
  }
}

function prefixed(head: string, body: string): string[] {
  const lines = body.split("\n");
  const [first = "", ...rest] = lines;
  return [`${head} ${first}`.trimEnd(), ...rest];
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

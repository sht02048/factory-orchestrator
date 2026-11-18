import type { WorkerReadResult } from "./schemas.js";

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

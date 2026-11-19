import { listRunners } from "@ganger/db";
import type { Database } from "@ganger/db";
import { loadHomePage } from "@ganger/app/home/load";
import { localTimeZone } from "@ganger/app/time-zone";
import type { HomePage } from "@ganger/app/home/model";
import { ALL_WORKSPACES } from "@ganger/app/shell/model";

export type AttentionEvent =
  | { kind: "question"; key: string; runId: string; ticketKey: string }
  | { kind: "permission"; key: string; runId: string; ticketKey: string }
  | { kind: "human-check"; key: string; runId: string; ticketKey: string }
  | { kind: "runner-offline"; key: string; runnerId: string; runnerName: string };

export interface AttentionRunner {
  id: string;
  name: string;
  online: boolean;
  checkedAt: Date | null;
}

export function attentionEvents(
  page: HomePage,
  runners: ReadonlyArray<AttentionRunner>,
): AttentionEvent[] {
  const events: AttentionEvent[] = [];
  for (const item of page.attention) {
    if (item.kind !== "run") continue;
    const { run } = item;
    if (run.state === "waiting-for-input") {
      const input = run.input;
      if (input?.kind === "question" && !input.answered) {
        events.push({
          kind: "question",
          key: `question:${input.questionId}`,
          runId: run.id,
          ticketKey: run.ticketKey,
        });
      } else if (input?.kind === "permission" && !input.denied) {
        events.push({
          kind: "permission",
          key: `permission:${input.promptId}`,
          runId: run.id,
          ticketKey: run.ticketKey,
        });
      }
    } else if (run.state === "ended" && run.summary === "human-check") {
      events.push({
        kind: "human-check",
        key: `human-check:${run.id}`,
        runId: run.id,
        ticketKey: run.ticketKey,
      });
    }
  }
  for (const runner of runners) {
    if (runner.online || runner.checkedAt === null) continue;
    events.push({
      kind: "runner-offline",
      key: `runner-offline:${runner.id}`,
      runnerId: runner.id,
      runnerName: runner.name,
    });
  }
  return events;
}

export function loadAttention(db: Database, now: Date): AttentionEvent[] {
  return attentionEvents(loadHomePage(db, ALL_WORKSPACES, now, localTimeZone()), listRunners(db));
}

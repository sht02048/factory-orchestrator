import { listRunners } from "@factory/db";
import type { Database } from "@factory/db";
import { loadHomePage } from "../home/load";
import type { HomePage } from "../home/model";
import { ALL_WORKSPACES } from "../shell/model";

/*
 * 알림할 사건 `GET /api/attention`(티켓 0046, Q4). 데스크톱 앱이 로컬·원격 모두 이 경로를 폴링하고, 앞 응답에 없던
 * 키가 생기면 OS 알림을 띄운다. 알리는 것은 질문 대기, 권한 대기, Human Check, 러너 Offline 넷뿐이다.
 * Merged·Failed 는 담지 않는다.
 *
 * 모양을 바꾸면 apps/desktop 의 attentionSchema 도 함께 바꾼다(계약: docs/tickets/0046 「알림 사건 경로 계약」).
 * 화면과 같은 Host 검사를 받는다(request-guard). 티켓 키와 러너 이름이 든다.
 */

export type AttentionEvent =
  | { kind: "question"; key: string; runId: string; ticketKey: string }
  | { kind: "permission"; key: string; runId: string; ticketKey: string }
  | { kind: "human-check"; key: string; runId: string; ticketKey: string }
  | { kind: "runner-offline"; key: string; runnerId: string; runnerName: string };

export interface AttentionRunner {
  id: string;
  name: string;
  online: boolean;
  /** 아직 한 번도 확인하지 않은 러너는 Offline 으로 알리지 않는다 */
  checkedAt: Date | null;
}

/**
 * 홈의 손댈 일(모든 Workspace)과 러너에서 알릴 사건을 고른다. 키는 사건마다 다르다. 질문·권한 대기는 그 ID 라
 * 새 질문이 오면 새 키가 되고, 러너 Offline 은 러너 ID 라 다시 Online 이 됐다가 Offline 이 되면 다시 알린다.
 */
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
      // 답이나 거절을 남겨 worker 가 보내기를 기다리는 입력은 사람이 이미 손댔다.
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
  return attentionEvents(loadHomePage(db, ALL_WORKSPACES, now), listRunners(db));
}

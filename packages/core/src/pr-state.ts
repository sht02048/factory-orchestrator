import type { PullRequestSnapshot } from "./adapters.js";
import type { RepoRef, TicketKey } from "./ids.js";
import type { PrState } from "./run.js";

export interface PrStateDecision {
  prState: PrState;
  /** PR 상태를 정한 PR. 없음이면 null */
  pr: PullRequestSnapshot | null;
}

/**
 * 런과 이어진 PR에서 PR 상태 하나를 정한다(스펙 3절 7번·4.2, Q40·Q82.6, research 0006 17·20절).
 *
 * 1. 런의 저장소에서 온 PR만 쓴다: `sourceRepo`가 런의 저장소와 같다(포크에서 온 PR을
 *    거른다). `baseBranch`를 주면 PR의 `baseBranch`도 같아야 한다(research 0002 C.2).
 * 2. 1순위는 런 시작 때 러너에서 받은 실제 브랜치의 PR(`byBranch`)이다. 그중 가장 최근 PR이 열림이나
 *    병합됨이면 그것을 쓴다.
 * 3. 1순위가 없거나 닫힘(병합 없이)이면 2순위인 PR 제목·본문의 티켓 키로 찾은 PR(`byTicketKey`)을 본다.
 *    에이전트가 브랜치 이름을 바꿔 원래 PR이 닫히고 새 브랜치로 PR을 다시 연 경우를 닫힘으로 잘못
 *    판정하지 않기 위해서다. 런이 시작한 뒤에 만든 PR만 쓴다(같은 티켓의 앞 런이 만든 PR을 잇지 않는다).
 *    제목에 키가 있는 PR을 본문에만 있는 PR보다 먼저 고른다.
 * 4. 2순위도 없으면 1순위의 닫힌 PR을, 그것도 없으면 없음이다.
 * 5. 같은 순위 안에서는 가장 최근에 만든 PR을 쓴다. 만든 시각이 같으면 목록에서 뒤에 있는 PR을 쓴다.
 * 6. PR `state`만 본다. CI 상태는 쓰지 않는다(research 0002 C.4, Q79).
 */
export function decidePrState(input: {
  repo: RepoRef;
  baseBranch?: string;
  ticketKey: TicketKey;
  runStartedAt: Date;
  byBranch: ReadonlyArray<PullRequestSnapshot>;
  byTicketKey: ReadonlyArray<PullRequestSnapshot>;
}): PrStateDecision {
  const belongs = (pr: PullRequestSnapshot): boolean =>
    pr.sourceRepo === input.repo &&
    (input.baseBranch === undefined || pr.baseBranch === input.baseBranch);
  const createdDuringRun = (pr: PullRequestSnapshot): boolean =>
    pr.createdAt.getTime() >= input.runStartedAt.getTime();

  const first = latest(input.byBranch.filter(belongs));
  if (first !== null && toPrState(first.state) !== "closed") return decided(first);

  const keyed = input.byTicketKey.filter((p) => belongs(p) && createdDuringRun(p));
  const second =
    latest(keyed.filter((p) => mentionsTicketKey(p.title, input.ticketKey))) ?? latest(keyed);
  const pr = second ?? first;
  return pr === null ? { prState: "none", pr: null } : decided(pr);
}

function decided(pr: PullRequestSnapshot): PrStateDecision {
  return { prState: toPrState(pr.state), pr };
}

/**
 * 글에 티켓 키가 낱말로 있는지. 대소문자를 가리지 않고, ENG-123이 ENG-1234에 걸리지 않는다
 * (research 0006 20절). 코드 호스트 어댑터가 키 검색 결과를 다시 거를 때도 쓴다.
 */
export function mentionsTicketKey(text: string, key: TicketKey): boolean {
  const escaped = key.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i").test(text);
}

function latest(prs: ReadonlyArray<PullRequestSnapshot>): PullRequestSnapshot | null {
  let best: PullRequestSnapshot | null = null;
  for (const pr of prs) {
    if (best === null || pr.createdAt.getTime() >= best.createdAt.getTime()) {
      best = pr;
    }
  }
  return best;
}

function toPrState(state: PullRequestSnapshot["state"]): PrState {
  switch (state) {
    case "merged":
      return "merged";
    case "closed":
      return "closed";
    case "open":
      return "open";
    default:
      // 모르는 값은 열림으로 다뤄 워크트리를 지우지 않는 쪽으로 보낸다.
      return "open";
  }
}

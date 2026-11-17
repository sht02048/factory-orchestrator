import type { PullRequestSnapshot } from "./adapters.js";
import type { RepoRef } from "./ids.js";
import type { PrState } from "./run.js";

export interface PrStateDecision {
  prState: PrState;
  /** PR 상태를 정한 PR. 없음이면 null */
  pr: PullRequestSnapshot | null;
}

/**
 * 런과 이어진 PR에서 PR 상태 하나를 정한다(스펙 3.7·4.2, Q40).
 *
 * 1. 런의 저장소에서 온 PR만 쓴다: `sourceRepo`가 런의 저장소와 같다(포크에서 온 PR을
 *    거른다). `baseBranch`를 주면 PR의 `baseBranch`도 같아야 한다(research 0002 C.2).
 * 2. 오케스트레이터가 정한 브랜치의 PR(`byBranch`)이 있으면 그것을, 없으면 PR 제목·본문의
 *    티켓 키로 찾은 PR(`byTicketKey`)을 쓴다. 티켓 키로 찾은 PR은 런이 시작한 뒤에 만든 것만
 *    쓴다. 같은 티켓의 앞 런이 만든 PR을 이번 런의 PR로 잇지 않기 위해서다.
 * 3. 여럿이면 가장 최근에 만든 PR을 쓴다. 만든 시각이 같으면 목록에서 뒤에 있는 PR을 쓴다.
 * 4. PR `state`만 본다. CI 상태는 쓰지 않는다(research 0002 C.4).
 */
export function decidePrState(input: {
  repo: RepoRef;
  baseBranch?: string;
  runStartedAt: Date;
  byBranch: ReadonlyArray<PullRequestSnapshot>;
  byTicketKey: ReadonlyArray<PullRequestSnapshot>;
}): PrStateDecision {
  const belongs = (pr: PullRequestSnapshot): boolean =>
    pr.sourceRepo === input.repo &&
    (input.baseBranch === undefined || pr.baseBranch === input.baseBranch);
  const createdDuringRun = (pr: PullRequestSnapshot): boolean =>
    pr.createdAt.getTime() >= input.runStartedAt.getTime();

  const pr =
    latest(input.byBranch.filter(belongs)) ??
    latest(input.byTicketKey.filter((p) => belongs(p) && createdDuringRun(p)));
  return pr === null ? { prState: "none", pr: null } : { prState: toPrState(pr.state), pr };
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

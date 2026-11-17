import type { PullRequestSnapshot, RepoRef } from "./adapters.js";
import type { PrState } from "./run.js";

export interface PrStateDecision {
  prState: PrState;
  /** PR 상태를 정한 PR. 없음이면 null */
  pr: PullRequestSnapshot | null;
}

/**
 * 런과 이어진 PR에서 PR 상태 하나를 정한다(스펙 3.7·4.2, Q40).
 *
 * 1. 런의 저장소에서 온 PR만 쓴다: `isCrossRepository: false`이고 `headRepository`가 같다.
 *    `baseBranch`를 주면 `baseRefName`도 같아야 한다(research 0002 C.2).
 * 2. 오케스트레이터가 정한 브랜치의 PR(`byBranch`)이 있으면 그것을, 없으면 PR 제목·본문의
 *    티켓 키로 찾은 PR(`byTicketKey`)을 쓴다.
 * 3. 여럿이면 가장 최근에 만든 PR을 쓴다.
 * 4. PR `state`만 본다. CI 상태는 쓰지 않는다(research 0002 C.4).
 */
export function decidePrState(input: {
  repo: RepoRef;
  baseBranch?: string;
  byBranch: ReadonlyArray<PullRequestSnapshot>;
  byTicketKey: ReadonlyArray<PullRequestSnapshot>;
}): PrStateDecision {
  const belongs = (pr: PullRequestSnapshot): boolean =>
    !pr.isCrossRepository &&
    pr.headRepository !== null &&
    sameRepo(pr.headRepository, input.repo) &&
    (input.baseBranch === undefined || pr.baseRefName === input.baseBranch);

  const pr = latest(input.byBranch.filter(belongs)) ?? latest(input.byTicketKey.filter(belongs));
  return pr === null ? { prState: "none", pr: null } : { prState: toPrState(pr.state), pr };
}

function sameRepo(a: RepoRef, b: RepoRef): boolean {
  // GitHub 저장소 이름은 대소문자를 가리지 않는다.
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase()
  );
}

function latest(prs: ReadonlyArray<PullRequestSnapshot>): PullRequestSnapshot | null {
  let best: PullRequestSnapshot | null = null;
  for (const pr of prs) {
    if (
      best === null ||
      pr.createdAt.getTime() > best.createdAt.getTime() ||
      (pr.createdAt.getTime() === best.createdAt.getTime() && pr.number > best.number)
    ) {
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

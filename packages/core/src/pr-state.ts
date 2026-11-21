import type { PullRequestSnapshot } from "./adapters.js";
import type { RepoRef, TicketKey } from "./ids.js";
import type { ReadPrState } from "./run.js";

export interface PrStateDecision {
  prState: ReadPrState;
  pr: PullRequestSnapshot | null;
}

export function decidePrState(input: {
  repo: RepoRef;
  baseBranch?: string;
  ticketKey: TicketKey;
  runStartedAt: Date;
  continuesEarlierRun?: boolean;
  byBranch: ReadonlyArray<PullRequestSnapshot>;
  byTicketKey: ReadonlyArray<PullRequestSnapshot>;
}): PrStateDecision {
  const belongs = (pr: PullRequestSnapshot): boolean =>
    pr.sourceRepo === input.repo &&
    (input.baseBranch === undefined || pr.baseBranch === input.baseBranch);
  const createdDuringRun = (pr: PullRequestSnapshot): boolean =>
    pr.createdAt.getTime() >= input.runStartedAt.getTime();

  const settledBeforeRun = (pr: PullRequestSnapshot): boolean => {
    if (input.continuesEarlierRun !== true) return false;
    const startedAt = input.runStartedAt.getTime();
    if (pr.state === "merged") return pr.mergedAt !== null && pr.mergedAt.getTime() < startedAt;
    return pr.state === "closed" && pr.createdAt.getTime() < startedAt;
  };

  const first = latest(input.byBranch.filter((pr) => belongs(pr) && !settledBeforeRun(pr)));
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

function toPrState(state: PullRequestSnapshot["state"]): ReadPrState {
  switch (state) {
    case "merged":
      return "merged";
    case "closed":
      return "closed";
    case "open":
      return "open";
    default:
      return "open";
  }
}

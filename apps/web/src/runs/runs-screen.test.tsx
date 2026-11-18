import { toAgentId, toRunnerProjectId, toTicketKey, toTrackerProjectId } from "@ganger/core";
import { assignRun, changeRunState, requestRunCancel } from "@ganger/db";
import type { Database } from "@ganger/db";
import { describe, expect, it } from "vitest";
import domain from "../../messages/ko/domain.json" with { type: "json" };
import runsJson from "../../messages/ko/runs.json" with { type: "json" };
import { renderWithMessages } from "../testing/render";
import {
  connection,
  endedCases,
  labs,
  minutes,
  now,
  offlineQueuedKey,
  seedDatabase,
} from "../testing/seed";
import { loadHomePage } from "../home/load";
import { loadRunsPage } from "./load";
import { runsMessages } from "./messages";
import type { RunFilter, RunsPage } from "./model";
import { RunsScreen } from "./runs-screen";

const noop = () => {};

function render(
  page: RunsPage,
  options: { filter?: RunFilter; selectedId?: string | undefined } = {},
) {
  return renderWithMessages(
    <RunsScreen
      page={page}
      workspaces={[
        { id: "ws-commerce", name: "Acme Commerce" },
        { id: "ws-labs", name: "Acme Labs" },
      ]}
      filter={options.filter ?? "all"}
      selectedId={options.selectedId}
      onFilterChange={noop}
      onSelect={noop}
      onOpen={noop}
      onPickWorkspace={noop}
      onShowMoreEnded={noop}
      runHref={(id) => `/runs/${id}`}
    />,
    runsMessages,
  );
}

function rowTexts(html: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const chunk of html.split('role="option"').slice(1)) {
    const row = chunk.split('role="option"')[0] ?? "";
    const cells = row
      .split(/<[^>]+>/)
      .map((s) => s.trim())
      .filter((s) => s !== "" && !s.includes("="));
    const key = cells[0];
    if (key !== undefined) rows.set(key, cells);
  }
  return rows;
}

function panelText(html: string): string {
  const panel = html.split("<aside")[1] ?? "";
  return panel.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function addProjectMissingRun(db: Database, key: string): string {
  const result = assignRun(db, {
    ticket: { connection, key: toTicketKey(key) },
    trackerProject: toTrackerProjectId("tp-web"),
    runnerProject: toRunnerProjectId("github:acme/gone"),
    agent: toAgentId("claude"),
    now: minutes(100),
  });
  if (!result.ok) throw new Error(result.reason);
  return result.run.id;
}

describe("Runs 화면", () => {
  it("Ended 런은 알약에 요약 결과, 흐린 줄에 러너와 에이전트 결과를 보인다", () => {
    const { db } = seedDatabase();
    const rows = rowTexts(render(loadRunsPage(db, undefined, now)));
    for (const c of endedCases) {
      const cells = rows.get(c.key);
      expect({ key: c.key, pill: cells?.[2] }).toEqual({
        key: c.key,
        pill: domain.summary[c.summary],
      });
      expect(cells?.[1]).toContain(domain.agentResult[c.agentResult]);
    }
  });

  it("Ended 가 아닌 런은 알약에 런 상태, 흐린 줄에 러너와 에이전트를 보인다", () => {
    const { db } = seedDatabase();
    const rows = rowTexts(render(loadRunsPage(db, undefined, now)));
    expect(rows.get("ACME-10")?.slice(1, 3)).toEqual([
      `runner-a · ${domain.agent.claude}`,
      domain.runState.running,
    ]);
    expect(rows.get("ACME-11")?.[2]).toBe(domain.runState["waiting-for-input"]);
    expect(rows.get("ACME-12")?.[2]).toBe(domain.runState.disconnected);
    expect(rows.get("ACME-13")?.[2]).toBe(domain.runState.queued);
    expect(rows.get(offlineQueuedKey)?.[1]).toContain(runsJson.noRunner);
  });

  it("시간 칸은 끝난 런이면 상대 시간, 진행 중이면 경과다(ADR 0010 7번)", () => {
    const { db } = seedDatabase();
    const page = loadRunsPage(db, undefined, now);
    const rows = rowTexts(render(page));
    const times = page.runs.map((run) => ({
      ended: run.state === "ended",
      time: rows.get(run.ticketKey)?.[3] ?? "",
    }));
    const relative = /^(방금|\d+(분|시간) 전|\d+월 \d+일)$/;
    expect(times.filter((r) => r.ended).every((r) => relative.test(r.time))).toBe(true);
    expect(times.filter((r) => !r.ended).every((r) => r.time.endsWith("째"))).toBe(true);
    expect(times.some((r) => r.ended) && times.some((r) => !r.ended)).toBe(true);
  });

  it("패널에 상태, 요약 결과, 두 축, 러너, 에이전트, 경과 시간, PR 을 보인다", () => {
    const { db, ids } = seedDatabase();
    const text = panelText(
      render(loadRunsPage(db, undefined, now), { selectedId: ids.get("ACME-2") }),
    );
    expect(text).toContain(domain.summary["human-check"]);
    expect(text).toContain(domain.agentResult["reported-failure"]);
    expect(text).toContain(domain.prState.open);
    expect(text).toContain(runsJson.panel.reason["human-check"]);
    expect(text).toContain("runner-a");
    expect(text).toContain(domain.agent.claude);
    expect(text).toContain("29분");
    expect(text).toContain("#2");
  });

  it("패널에 Run 상세로 가는 링크를 둔다", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-2");
    const html = render(loadRunsPage(db, undefined, now), { selectedId: id });
    expect(html).toContain(`href="/runs/${id ?? ""}"`);
    expect(panelText(html)).toContain(runsJson.panel.openDetail);
  });

  it("진행 중인 런의 경과 시간은 패널에 한 번만 보인다", () => {
    const { db, ids } = seedDatabase();
    const page = loadRunsPage(db, undefined, now);
    const running = page.runs.find((run) => run.ticketKey === "ACME-10");
    const minutesElapsed = Math.floor((running?.executionMs ?? 0) / 60_000);
    const text = panelText(render(page, { selectedId: ids.get("ACME-10") }));
    expect(text.match(/째/g)).toHaveLength(1);
    expect(text).not.toContain(`${String(minutesElapsed)}분 `);
  });

  it("러너가 Offline 이면 패널에 Offline 알약을 보인다", () => {
    const { db, ids } = seedDatabase();
    const page = loadRunsPage(db, undefined, now);
    const id = ids.get("ACME-10");
    const offline: RunsPage = {
      ...page,
      runs: page.runs.map((run) =>
        run.id === id ? { ...run, runner: { name: "runner-a", online: false } } : run,
      ),
    };
    const html = render(offline, { selectedId: id }).split("<aside")[1] ?? "";
    expect(html).toContain(`>${domain.runnerState.offline}<`);
  });

  it("필터에 맞는 런이 없으면 패널에 빈 상태 한 줄을 둔다", () => {
    const { db } = seedDatabase();
    const page = loadRunsPage(db, labs, now);
    expect(panelText(render(page, { filter: "merged" }))).toContain(runsJson.panel.empty);
    const empty: RunsPage = { ...page, runs: [] };
    expect(panelText(render(empty))).toContain(runsJson.panel.noRuns);
  });

  it("걸린 조건을 지울 수 있는 버튼 줄로 보이고, 맞는 런이 없으면 조건 때문이라고 알린다(0075)", () => {
    const { db } = seedDatabase();
    const page = loadRunsPage(db, undefined, now, 50, {
      runner: "runner-a",
      agent: "codex",
      days: 7,
    });
    const html = render(page);
    expect(html).toContain(`role="group" aria-label="${runsJson.conditions.label}"`);
    expect(html).toContain(">러너: runner-a<");
    expect(html).toContain(`aria-label="러너: runner-a 조건 지우기"`);
    expect(html).toContain(">기간: 최근 7일<");
    expect(html).toContain(`>${runsJson.conditions.clearAll}<`);
    expect(html).toContain(runsJson.noRunsWithConditions);
    expect(panelText(html)).toContain(runsJson.panel.noRunsWithConditions);

    const one = render(loadRunsPage(db, undefined, now, 50, { runner: "" }));
    expect(one).toContain(`>${runsJson.conditions.noRunner}<`);
    expect(one).not.toContain(runsJson.conditions.clearAll);
    expect(render(loadRunsPage(db, undefined, now))).not.toContain(runsJson.conditions.label);
  });

  it("끝난 런이 더 있으면 몇 개까지 보이는지 알리고 '더 보기'를 둔다", () => {
    const { db } = seedDatabase();
    const page: RunsPage = { ...loadRunsPage(db, undefined, now), moreEnded: true };
    const ended = page.runs.filter((run) => run.state === "ended").length;
    const html = render(page);
    expect(html).toContain(runsJson.ended.partial.replace("{count}", String(ended)));
    expect(html).toContain(`>${runsJson.ended.showMore}<`);
    expect(render({ ...page, moreEnded: false })).not.toContain(runsJson.ended.showMore);
  });

  it("Queued 런의 패널에 기다리는 이유를 보인다(Q65·Q68)", () => {
    const { db, ids } = seedDatabase();
    const page = loadRunsPage(db, undefined, now);
    expect(panelText(render(page, { selectedId: ids.get(offlineQueuedKey) }))).toContain(
      domain.queuedReason["runner-offline"],
    );
    expect(panelText(render(page, { selectedId: ids.get("ACME-13") }))).toContain(
      domain.queuedReason.starting,
    );
  });

  it("상태 필터는 고른 상태나 요약 결과의 런만 보이고 개수를 센다", () => {
    const { db } = seedDatabase();
    const page = loadRunsPage(db, undefined, now);
    const failed = rowTexts(render(page, { filter: "failed" }));
    expect([...failed.keys()].sort()).toEqual(
      endedCases
        .filter((c) => c.summary === "failed")
        .map((c) => c.key)
        .sort(),
    );
    const waiting = rowTexts(render(page, { filter: "waiting-for-input" }));
    expect([...waiting.keys()]).toEqual(["ACME-11"]);
    const queued = rowTexts(render(page, { filter: "queued" }));
    expect([...queued.keys()].sort()).toEqual(["ACME-13", offlineQueuedKey].sort());
  });

  it("처리할 일 칩과 머리글 수는 Dashboard 의 To do 런과 같다(티켓마다 마지막 런)", () => {
    const { db, ids } = seedDatabase();
    const homeRunIds = (): string[] =>
      loadHomePage(db, "ws-commerce", now, "UTC")
        .attention.flatMap((item) => (item.kind === "run" ? [item.run.id] : []))
        .sort();
    const attentionIds = (page: RunsPage): string[] => {
      const keys = new Set(rowTexts(render(page, { filter: "attention" })).keys());
      return page.runs
        .filter((run) => keys.has(run.ticketKey) && run.attention)
        .map((run) => run.id)
        .sort();
    };

    let page = loadRunsPage(db, undefined, now);
    expect(attentionIds(page)).toEqual(homeRunIds());
    expect(homeRunIds().length).toBeGreaterThan(0);
    expect(render(page)).toContain(
      `${page.runs.length}개 중 ${homeRunIds().length}개가 처리할 일이에요.`,
    );

    const failedKey = endedCases.find((c) => c.summary === "failed")?.key;
    if (failedKey === undefined) throw new Error("seed");
    const result = assignRun(db, {
      ticket: { connection, key: toTicketKey(failedKey) },
      trackerProject: toTrackerProjectId("tp-web"),
      runnerProject: toRunnerProjectId("github:acme/web"),
      agent: toAgentId("claude"),
      now: minutes(110),
    });
    expect(result.ok).toBe(true);
    page = loadRunsPage(db, undefined, now);
    const oldFailed = ids.get(failedKey);
    expect(page.runs.find((run) => run.id === oldFailed)?.attention).toBe(false);
    expect(attentionIds(page)).toEqual(homeRunIds());
  });

  it('Canceled 필터는 운영자가 취소한 런만 "취소"로 보인다(Q82.18)', () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-13");
    if (id === undefined) throw new Error("seed");
    const ended = changeRunState(
      db,
      id,
      { to: "ended", agentResult: "canceled", prState: "none" },
      minutes(110),
    );
    expect(ended.ok).toBe(true);
    const page = loadRunsPage(db, undefined, now);
    const canceled = rowTexts(render(page, { filter: "canceled" }));
    expect([...canceled.keys()]).toEqual(["ACME-13"]);
    expect(canceled.get("ACME-13")?.[2]).toBe(domain.summary.canceled);
    expect(canceled.get("ACME-13")?.[1]).toContain(domain.agentResult.canceled);
    expect(rowTexts(render(page, { filter: "failed" })).has("ACME-13")).toBe(false);
  });

  it("Offline 과 러너에서 프로젝트가 빠짐의 Queued 이유를 다른 문구로 보인다(Q68·Q82.13)", () => {
    const { db, ids } = seedDatabase();
    const missing = addProjectMissingRun(db, "ACME-15");
    const page = loadRunsPage(db, undefined, now);
    const offlineText = panelText(render(page, { selectedId: ids.get(offlineQueuedKey) }));
    const missingText = panelText(render(page, { selectedId: missing }));
    expect(offlineText).toContain(domain.queuedReason["runner-offline"]);
    expect(offlineText).not.toContain(domain.queuedReason["project-missing"]);
    expect(missingText).toContain(domain.queuedReason["project-missing"]);
    expect(missingText).not.toContain(domain.queuedReason["runner-offline"]);
    expect(domain.queuedReason["project-missing"]).not.toBe(domain.queuedReason["runner-offline"]);
  });

  it("처리되지 않은 취소 요청이 있는 런에 취소 중을 보인다(Q82.21)", () => {
    const { db, ids } = seedDatabase();
    const id = ids.get("ACME-10");
    if (id === undefined) throw new Error("seed");
    expect(requestRunCancel(db, id, minutes(110)).ok).toBe(true);
    const page = loadRunsPage(db, undefined, now);
    const rows = rowTexts(render(page));
    expect(rows.get("ACME-10")?.[1]).toContain(runsJson.cancelling);
    expect(rows.get("ACME-10")?.[2]).toBe(domain.runState.running);
    expect(rows.get("ACME-11")?.[1]).not.toContain(runsJson.cancelling);
    const text = panelText(render(page, { selectedId: id }));
    expect(text).toContain(runsJson.panel.cancelling);
    expect(text).toContain(runsJson.panel.cancellingReason);
  });

  it("Workspace 를 바꾸면 그 Workspace 의 런만 보인다", () => {
    const { db } = seedDatabase();
    const labsRows = rowTexts(render(loadRunsPage(db, labs, now)));
    expect([...labsRows.keys()]).toEqual(["LAB-1"]);
    const commerceRows = rowTexts(render(loadRunsPage(db, "ws-commerce", now)));
    expect(commerceRows.has("LAB-1")).toBe(false);
    expect(commerceRows.has("ACME-1")).toBe(true);
  });

  it("전체에서는 Workspace 를 고르라고 보인다", () => {
    const { db } = seedDatabase();
    const html = render(loadRunsPage(db, "all", now));
    expect(html).toContain(runsJson.allWorkspaces.body);
    expect(html).toContain("Acme Labs");
    expect(html).not.toContain('role="option"');
  });

  it("문구는 메시지 파일에서 온다", () => {
    const { db } = seedDatabase();
    const html = render(loadRunsPage(db, undefined, now));
    expect(html).toContain(runsJson.title);
    expect(html).toContain(runsJson.filter.attention);
    expect(html).not.toMatch(/\b(runs|domain)\.[a-zA-Z]/);
  });
});

/*
 * 시안용 목 데이터. 용어는 GLOSSARY.md를 따른다.
 * 기준 시각: 2026-11-17(화) 14:20, 운영자 한 명.
 * 결과 판정(ADR 0004): 런이 끝났을 때 PR이 병합됐으면 Merged, 열려 있으면 Human Check, PR이 없으면 Failed.
 */
window.FO = (function () {
  const NOW_LABEL = "11월 17일 14:20";
  const AUTO_LABEL = "factory";

  const agents = {
    claude: { id: "claude", name: "Claude Code" },
    codex: { id: "codex", name: "Codex" },
  };

  const trackerProjects = [
    { key: "WEB", name: "Web Console" },
    { key: "BIL", name: "Billing" },
    { key: "MOB", name: "Mobile" },
    { key: "PLT", name: "Platform" },
  ];

  const runners = [
    {
      id: "runner-a",
      host: "runner-a.example.com",
      online: true,
      capacity: 3,
      running: 3,
      lastSeen: "방금",
      os: "macOS 26.1 · M4 Pro",
      orca: "Orca 1.14.2",
      projects: [
        { name: "acme/web", worktrees: 2 },
        { name: "acme/platform", worktrees: 1 },
        { name: "acme/design-tokens", worktrees: 0 },
      ],
    },
    {
      id: "runner-b",
      host: "runner-b.example.com",
      online: true,
      capacity: 2,
      running: 1,
      lastSeen: "12초 전",
      os: "macOS 26.1 · M3 Max",
      orca: "Orca 1.14.2",
      projects: [
        { name: "acme/mobile", worktrees: 1 },
        { name: "acme/web", worktrees: 0 },
      ],
    },
    {
      id: "runner-c",
      host: "runner-c.example.com",
      online: false,
      capacity: 4,
      running: 0,
      lastSeen: "42분 전",
      os: "Ubuntu 24.04 · 16 vCPU",
      orca: "Orca 1.13.0",
      projects: [
        { name: "acme/billing", worktrees: 0 },
        { name: "acme/data-pipeline", worktrees: 0 },
      ],
    },
  ];

  const mappings = [
    { tracker: "Web Console", runner: "runner-a", project: "acme/web", agent: "claude", fallback: "runner-b" },
    { tracker: "Billing", runner: "runner-c", project: "acme/billing", agent: "codex", fallback: null },
    { tracker: "Mobile", runner: "runner-b", project: "acme/mobile", agent: "claude", fallback: null },
    { tracker: "Platform", runner: "runner-a", project: "acme/platform", agent: "codex", fallback: null },
  ];

  /*
   * state: queued | running | done
   * result: merged | check | failed (state가 done일 때만)
   * pr: { number, state: open | merged, ci: passed | failed | running }
   */
  const runs = [
    // 진행 중
    { id: 1052, ticket: "ACME-418", state: "running", runner: "runner-a", agent: "claude", started: "14:02", elapsed: 18, step: "테스트 돌리는 중", progress: 0.62, pr: null },
    { id: 1053, ticket: "ACME-88", state: "running", runner: "runner-a", agent: "codex", started: "14:07", elapsed: 13, step: "CI 기다리는 중", progress: 0.86, pr: { number: 214, state: "open", ci: "running" } },
    { id: 1054, ticket: "ACME-421", state: "running", runner: "runner-a", agent: "claude", started: "14:11", elapsed: 9, step: "코드 읽는 중", progress: 0.2, pr: null },
    { id: 1055, ticket: "ACME-203", state: "running", runner: "runner-b", agent: "claude", started: "13:48", elapsed: 32, step: "PR 여는 중", progress: 0.74, pr: null },

    // Queued
    { id: 1056, ticket: "ACME-425", state: "queued", runner: "runner-a", agent: "claude", queuedFor: 6, queueReason: "runner-a의 capacity 3개를 모두 쓰고 있어요" },
    { id: 1050, ticket: "ACME-131", state: "queued", runner: "runner-c", agent: "codex", queuedFor: 38, queueReason: "runner-c가 Offline이에요" },
    { id: 1057, ticket: "ACME-134", state: "queued", runner: "runner-c", agent: "codex", queuedFor: 4, queueReason: "runner-c가 Offline이에요" },

    // 끝남
    { id: 1051, ticket: "ACME-416", state: "done", result: "check", runner: "runner-a", agent: "claude", started: "13:21", elapsed: 41, ended: "14:02", pr: { number: 1187, state: "open", ci: "failed" }, note: "CI의 e2e 테스트가 실패해 PR을 열어 둔 채 끝냈어요" },
    { id: 1049, ticket: "ACME-129", state: "done", result: "failed", runner: "runner-c", agent: "codex", started: "13:11", elapsed: 27, ended: "13:38", pr: null, failReason: "runner", note: "러너 연결이 끊겨 PR을 남기지 못했어요" },
    { id: 1048, ticket: "ACME-199", state: "done", result: "merged", runner: "runner-b", agent: "claude", started: "12:40", elapsed: 36, ended: "13:16", pr: { number: 342, state: "merged", ci: "passed" } },
    { id: 1047, ticket: "ACME-412", state: "done", result: "merged", runner: "runner-a", agent: "claude", started: "12:05", elapsed: 24, ended: "12:29", pr: { number: 1184, state: "merged", ci: "passed" } },
    { id: 1046, ticket: "ACME-85", state: "done", result: "check", runner: "runner-a", agent: "codex", started: "11:30", elapsed: 52, ended: "12:22", pr: { number: 211, state: "open", ci: "passed" }, note: "마이그레이션이 있어 사람이 확인하도록 PR을 열어 뒀어요" },
    { id: 1045, ticket: "ACME-197", state: "done", result: "failed", runner: "runner-b", agent: "claude", started: "11:02", elapsed: 15, ended: "11:17", pr: null, failReason: "agent", note: "에이전트가 빌드 오류를 고치지 못하고 멈췄어요" },
    { id: 1044, ticket: "ACME-409", state: "done", result: "merged", runner: "runner-a", agent: "claude", started: "10:14", elapsed: 19, ended: "10:33", pr: { number: 1181, state: "merged", ci: "passed" } },
    { id: 1043, ticket: "ACME-127", state: "done", result: "merged", runner: "runner-c", agent: "codex", started: "09:50", elapsed: 33, ended: "10:23", pr: { number: 508, state: "merged", ci: "passed" } },
    { id: 1042, ticket: "ACME-83", state: "done", result: "merged", runner: "runner-a", agent: "codex", started: "09:12", elapsed: 28, ended: "09:40", pr: { number: 209, state: "merged", ci: "passed" } },
    { id: 1041, ticket: "ACME-197", state: "done", result: "check", runner: "runner-b", agent: "claude", started: "08:31", elapsed: 47, ended: "09:18", pr: { number: 339, state: "open", ci: "failed" }, note: "CI의 iOS 스냅숏 테스트가 실패했어요" },
  ];

  /*
   * trackerState: Linear 상태 그대로(트래커가 기준, ADR 0001)
   * assigned: 이 티켓을 러너에 맡겼는지
   */
  const tickets = [
    { id: "ACME-425", title: "결제 수단 목록에서 기본 카드가 맨 위에 오게 정렬하기", project: "Web Console", trackerState: "In Progress", labels: ["factory", "frontend"], priority: 2 },
    { id: "ACME-421", title: "팀 초대 메일의 만료 시간을 7일로 늘리기", project: "Web Console", trackerState: "In Progress", labels: ["factory"], priority: 3 },
    { id: "ACME-418", title: "대시보드 첫 화면 로딩이 3초 넘게 걸리는 문제 고치기", project: "Web Console", trackerState: "In Progress", labels: ["factory", "perf"], priority: 1 },
    { id: "ACME-416", title: "청구서 PDF 다운로드 버튼을 상세 화면 헤더로 옮기기", project: "Web Console", trackerState: "In Review", labels: ["factory", "frontend"], priority: 3 },
    { id: "ACME-412", title: "검색 입력에 300ms 디바운스 넣기", project: "Web Console", trackerState: "Done", labels: ["factory"], priority: 3 },
    { id: "ACME-428", title: "조직 설정 화면을 탭 구조로 나누기", project: "Web Console", trackerState: "Todo", labels: ["frontend", "design"], priority: 3 },
    { id: "ACME-134", title: "환불 웹훅이 두 번 들어와도 한 번만 처리되게 하기", project: "Billing", trackerState: "In Progress", labels: ["factory", "backend"], priority: 1 },
    { id: "ACME-131", title: "월말 정산 배치의 통화 반올림 오차 고치기", project: "Billing", trackerState: "In Progress", labels: ["factory", "backend"], priority: 2 },
    { id: "ACME-129", title: "인보이스 번호 생성 규칙을 연도별로 초기화하기", project: "Billing", trackerState: "In Progress", labels: ["backend"], priority: 3 },
    { id: "ACME-136", title: "쿠폰 만료 알림 문구를 해요체로 바꾸기", project: "Billing", trackerState: "Todo", labels: ["copy"], priority: 4 },
    { id: "ACME-203", title: "푸시 알림 권한 요청을 첫 실행 3일 뒤로 미루기", project: "Mobile", trackerState: "In Progress", labels: ["factory", "ios"], priority: 2 },
    { id: "ACME-199", title: "다크 모드에서 탭 바 아이콘 대비 높이기", project: "Mobile", trackerState: "Done", labels: ["factory", "ios"], priority: 3 },
    { id: "ACME-197", title: "오프라인일 때 결제 내역을 캐시에서 보여 주기", project: "Mobile", trackerState: "In Review", labels: ["android", "ios"], priority: 2 },
    { id: "ACME-88", title: "CI 캐시 키에 lockfile 해시 넣기", project: "Platform", trackerState: "In Progress", labels: ["factory", "infra"], priority: 3 },
    { id: "ACME-85", title: "감사 로그 테이블에 보존 기간 컬럼 추가하기", project: "Platform", trackerState: "In Review", labels: ["infra", "db"], priority: 2 },
    { id: "ACME-90", title: "스테이징 DB 스냅숏을 매일 새벽에 갱신하기", project: "Platform", trackerState: "Backlog", labels: ["infra"], priority: 4 },
    { id: "ACME-409", title: "로그인 실패 메시지에 다시 시도할 방법 적기", project: "Web Console", trackerState: "Done", labels: ["factory", "copy"], priority: 3 },
    { id: "ACME-127", title: "결제 실패 재시도 간격을 지수 백오프로 바꾸기", project: "Billing", trackerState: "Done", labels: ["factory", "backend"], priority: 2 },
    { id: "ACME-83", title: "로그 수집기 메모리 한도를 512MB로 올리기", project: "Platform", trackerState: "Done", labels: ["factory", "infra"], priority: 3 },
  ];

  const runDetails = {
    // Run 상세에서 기본으로 보여 줄 런(Human Check)
    1051: {
      branch: "factory/acme-416-invoice-pdf-button",
      worktree: "worktrees/acme-web/acme-416",
      timeline: [
        { time: "13:21", label: "할당했어요", detail: "자동 할당 라벨 factory로 시작했어요", tone: "queued" },
        { time: "13:21", label: "워크트리를 만들었어요", detail: "acme/web · factory/acme-416-invoice-pdf-button", tone: "running" },
        { time: "13:22", label: "에이전트를 시작했어요", detail: "Claude Code · 티켓 본문만 지시로 넘겼어요", tone: "running" },
        { time: "13:39", label: "PR #1187을 열었어요", detail: "변경 파일 6개 · +184 −52", tone: "running" },
        { time: "13:40", label: "CI를 기다렸어요", detail: "checks 5개", tone: "running" },
        { time: "13:58", label: "CI 1개가 실패했어요", detail: "e2e / invoice-download", tone: "failed" },
        { time: "14:02", label: "Human Check로 끝났어요", detail: "PR이 열린 채 런이 끝났어요", tone: "check" },
      ],
      checks: [
        { name: "lint", state: "passed", time: "38초" },
        { name: "typecheck", state: "passed", time: "1분 12초" },
        { name: "unit", state: "passed", time: "2분 4초" },
        { name: "build", state: "passed", time: "3분 40초" },
        { name: "e2e / invoice-download", state: "failed", time: "6분 18초" },
      ],
      log: [
        ["13:58:41", "info", "gh pr checks 1187 --watch"],
        ["13:58:42", "info", "✓ lint · ✓ typecheck · ✓ unit · ✓ build"],
        ["13:58:42", "error", "✗ e2e / invoice-download (6m18s)"],
        ["13:58:50", "info", "playwright: invoice-download.spec.ts:42 — 다운로드 버튼을 찾지 못했어요"],
        ["13:59:03", "info", "locator('header >> role=button[name=\"PDF 받기\"]') resolved to 0 elements"],
        ["13:59:40", "agent", "헤더 버튼의 접근성 이름이 바뀌어 테스트 셀렉터가 깨졌어요. 테스트를 고칠지 문구를 되돌릴지는 티켓에 기준이 없어요."],
        ["14:01:12", "agent", "기준을 정할 수 없어 PR을 열어 둔 채 끝낼게요."],
        ["14:02:05", "info", "run finished · pr=open → Human Check"],
      ],
    },
  };

  /* Stats: 최근 14일, 날짜별 결과 수(결정적인 값) */
  const days = ["11/4", "11/5", "11/6", "11/7", "11/8", "11/9", "11/10", "11/11", "11/12", "11/13", "11/14", "11/15", "11/16", "11/17"];
  const daily = [
    [6, 2, 1], [8, 1, 1], [7, 3, 0], [9, 2, 2], [3, 1, 0], [2, 0, 1], [10, 2, 1],
    [11, 3, 1], [9, 2, 2], [12, 1, 1], [10, 4, 1], [4, 1, 0], [3, 0, 1], [5, 3, 2],
  ].map(([merged, check, failed], i) => ({ day: days[i], merged, check, failed }));

  const leadTimes = [31, 28, 34, 29, 26, 41, 27, 25, 30, 24, 33, 29, 38, 32];

  const breakdowns = {
    runner: [
      { name: "runner-a", merged: 58, check: 13, failed: 4, p50: 26, p90: 48 },
      { name: "runner-b", merged: 30, check: 8, failed: 5, p50: 33, p90: 61 },
      { name: "runner-c", merged: 11, check: 4, failed: 5, p50: 31, p90: 74 },
    ],
    project: [
      { name: "acme/web", merged: 46, check: 10, failed: 3, p50: 24, p90: 45 },
      { name: "acme/mobile", merged: 27, check: 8, failed: 5, p50: 35, p90: 63 },
      { name: "acme/platform", merged: 15, check: 3, failed: 1, p50: 28, p90: 52 },
      { name: "acme/billing", merged: 11, check: 4, failed: 5, p50: 31, p90: 74 },
    ],
    agent: [
      { name: "Claude Code", merged: 73, check: 18, failed: 8, p50: 28, p90: 55 },
      { name: "Codex", merged: 26, check: 7, failed: 6, p50: 30, p90: 66 },
    ],
  };

  function ticket(id) {
    return tickets.find((t) => t.id === id);
  }

  function runsFor(ticketId) {
    return runs.filter((r) => r.ticket === ticketId).sort((a, b) => b.id - a.id);
  }

  function runner(id) {
    return runners.find((r) => r.id === id);
  }

  function mappingFor(projectName) {
    return mappings.find((m) => m.tracker === projectName);
  }

  return {
    NOW_LABEL, AUTO_LABEL, agents, trackerProjects, runners, mappings, runs, tickets,
    runDetails, daily, leadTimes, breakdowns, ticket, runsFor, runner, mappingFor,
  };
})();

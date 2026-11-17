/*
 * 시안 B 목 데이터. 용어는 GLOSSARY.md를 따른다. 값은 모두 가상이다.
 * 기준 시각: 2026-11-17(화) 14:20.
 * 결과 판정(ADR 0004): PR 병합 → Merged, PR 열림 → Human Check, PR 없음·닫힘 → Failed.
 */
window.FO = (function () {
  const AUTO_LABEL = "factory";

  const agents = {
    claude: "Claude Code",
    codex: "Codex",
  };

  /* 트래커 연결: 설치 단위, 여러 개 */
  const connections = [
    { id: "acme", name: "Acme", tracker: "Linear", org: "acme", projects: 5, webhook: "https://factory.example.com/hooks/linear/acme", lastEvent: "1분 전" },
    { id: "acme-labs", name: "Acme Labs", tracker: "Linear", org: "acme-labs", projects: 2, webhook: "https://factory.example.com/hooks/linear/acme-labs", lastEvent: "18분 전" },
  ];

  /* Workspace: 운영자가 트래커 프로젝트를 골라 묶은 단위 */
  const workspaces = [
    { id: "commerce", name: "Acme Commerce", projects: ["Web Console", "Billing", "Mobile"] },
    { id: "labs", name: "Acme Labs", projects: ["Platform", "Research"] },
  ];

  const trackerProjects = [
    { name: "Web Console", connection: "acme" },
    { name: "Billing", connection: "acme" },
    { name: "Mobile", connection: "acme" },
    { name: "Platform", connection: "acme" },
    { name: "Design System", connection: "acme" },
    { name: "Research", connection: "acme-labs" },
    { name: "Sandbox", connection: "acme-labs" },
  ];

  const runners = [
    {
      id: "runner-a", host: "runner-a.example.com", user: "factory", online: true, capacity: 3, lastSeen: "방금",
      os: "macOS 26.1", orca: "Orca 1.14.2", orcaPath: "/usr/local/bin/orca",
      projects: ["acme/web", "acme/platform", "acme/design-tokens"],
    },
    {
      id: "runner-b", host: "runner-b.example.com", user: "factory", online: true, capacity: 2, lastSeen: "12초 전",
      os: "macOS 26.1", orca: "Orca 1.14.2", orcaPath: "/opt/homebrew/bin/orca",
      projects: ["acme/mobile", "acme/web", "acme/research"],
    },
    {
      id: "runner-c", host: "runner-c.example.com", user: "factory", online: false, capacity: 4, lastSeen: "42분 전",
      os: "Ubuntu 24.04", orca: "Orca 1.13.0", orcaPath: "/home/factory/.local/bin/orca",
      projects: ["acme/billing", "acme/data-pipeline"],
    },
  ];

  const mappings = [
    { tracker: "Web Console", runner: "runner-a", project: "acme/web", agent: "claude" },
    { tracker: "Billing", runner: "runner-c", project: "acme/billing", agent: "codex" },
    { tracker: "Mobile", runner: "runner-b", project: "acme/mobile", agent: "claude" },
    { tracker: "Platform", runner: "runner-a", project: "acme/platform", agent: "codex" },
    { tracker: "Research", runner: "runner-b", project: "acme/research", agent: "claude" },
  ];

  /*
   * state: queued | running | done, result: merged | check | failed
   * failReason: agent | runner | closed
   */
  const runs = [
    { id: 1052, ticket: "ACME-418", state: "running", runner: "runner-a", agent: "claude", started: "14:02", elapsed: 18, step: "테스트를 돌리고 있어요", pr: null },
    { id: 1053, ticket: "ACME-88", state: "running", runner: "runner-a", agent: "codex", started: "14:07", elapsed: 13, step: "PR #214의 CI를 기다리고 있어요", pr: { number: 214, state: "open", ci: "running" } },
    { id: 1054, ticket: "ACME-421", state: "running", runner: "runner-a", agent: "claude", started: "14:11", elapsed: 9, step: "코드를 읽고 있어요", pr: null },
    { id: 1055, ticket: "ACME-203", state: "running", runner: "runner-b", agent: "claude", started: "13:48", elapsed: 32, step: "PR을 열고 있어요", pr: null },

    { id: 1056, ticket: "ACME-425", state: "queued", runner: "runner-a", agent: "claude", queued: "14:14", waited: 6, position: 2, reason: "runner-a의 capacity 3개를 모두 쓰고 있어요" },
    { id: 1050, ticket: "ACME-131", state: "queued", runner: "runner-c", agent: "codex", queued: "13:42", waited: 38, position: 1, reason: "runner-c가 Offline이에요" },
    { id: 1057, ticket: "ACME-134", state: "queued", runner: "runner-c", agent: "codex", queued: "14:16", waited: 4, position: 3, reason: "runner-c가 Offline이에요" },

    { id: 1051, ticket: "ACME-416", state: "done", result: "check", runner: "runner-a", agent: "claude", started: "13:21", elapsed: 41, ended: "14:02", pr: { number: 1187, state: "open", ci: "failed" }, note: "CI의 e2e 테스트가 실패해 PR을 열어 둔 채 끝냈어요." },
    { id: 1049, ticket: "ACME-129", state: "done", result: "failed", failReason: "runner", runner: "runner-c", agent: "codex", started: "13:11", elapsed: 27, ended: "13:38", pr: null, note: "러너 연결이 끊겨 PR을 남기지 못했어요." },
    { id: 1048, ticket: "ACME-199", state: "done", result: "merged", runner: "runner-b", agent: "claude", started: "12:40", elapsed: 36, ended: "13:16", pr: { number: 342, state: "merged", ci: "passed" } },
    { id: 1047, ticket: "ACME-412", state: "done", result: "merged", runner: "runner-a", agent: "claude", started: "12:05", elapsed: 24, ended: "12:29", pr: { number: 1184, state: "merged", ci: "passed" } },
    { id: 1046, ticket: "ACME-85", state: "done", result: "check", runner: "runner-a", agent: "codex", started: "11:30", elapsed: 52, ended: "12:22", pr: { number: 211, state: "open", ci: "passed" }, note: "마이그레이션이 있어 사람이 확인하도록 PR을 열어 뒀어요." },
    { id: 1045, ticket: "ACME-197", state: "done", result: "failed", failReason: "agent", runner: "runner-b", agent: "claude", started: "11:02", elapsed: 15, ended: "11:17", pr: null, note: "에이전트가 빌드 오류를 고치지 못하고 멈췄어요." },
    { id: 1044, ticket: "ACME-409", state: "done", result: "merged", runner: "runner-a", agent: "claude", started: "10:14", elapsed: 19, ended: "10:33", pr: { number: 1181, state: "merged", ci: "passed" } },
    { id: 1043, ticket: "ACME-127", state: "done", result: "merged", runner: "runner-c", agent: "codex", started: "09:50", elapsed: 33, ended: "10:23", pr: { number: 508, state: "merged", ci: "passed" } },
    { id: 1042, ticket: "ACME-83", state: "done", result: "merged", runner: "runner-a", agent: "codex", started: "09:12", elapsed: 28, ended: "09:40", pr: { number: 209, state: "merged", ci: "passed" } },
    { id: 1041, ticket: "ACME-197", state: "done", result: "check", runner: "runner-b", agent: "claude", started: "08:31", elapsed: 47, ended: "09:18", pr: { number: 339, state: "open", ci: "failed" }, note: "CI의 iOS 스냅숏 테스트가 실패했어요." },
    { id: 1040, ticket: "ACME-302", state: "done", result: "failed", failReason: "closed", runner: "runner-b", agent: "claude", started: "08:05", elapsed: 22, ended: "08:27", pr: { number: 41, state: "closed", ci: "passed" }, note: "누군가 PR #41을 닫아서 병합하지 못했어요." },
  ];

  const tickets = [
    { id: "ACME-425", title: "결제 수단 목록에서 기본 카드가 맨 위에 오게 정렬하기", project: "Web Console", trackerState: "In Progress", labels: ["factory", "frontend"] },
    { id: "ACME-421", title: "팀 초대 메일의 만료 시간을 7일로 늘리기", project: "Web Console", trackerState: "In Progress", labels: ["factory"] },
    { id: "ACME-418", title: "대시보드 첫 화면 로딩이 3초 넘게 걸리는 문제 고치기", project: "Web Console", trackerState: "In Progress", labels: ["factory", "perf"] },
    { id: "ACME-416", title: "청구서 PDF 다운로드 버튼을 상세 화면 헤더로 옮기기", project: "Web Console", trackerState: "In Review", labels: ["factory", "frontend"] },
    { id: "ACME-412", title: "검색 입력에 300ms 디바운스 넣기", project: "Web Console", trackerState: "Done", labels: ["factory"] },
    { id: "ACME-428", title: "조직 설정 화면을 탭 구조로 나누기", project: "Web Console", trackerState: "Todo", labels: ["frontend"] },
    { id: "ACME-430", title: "비밀번호 재설정 링크 만료 안내 문구 넣기", project: "Web Console", trackerState: "Todo", labels: ["copy"] },
    { id: "ACME-134", title: "환불 웹훅이 두 번 들어와도 한 번만 처리되게 하기", project: "Billing", trackerState: "In Progress", labels: ["factory", "backend"] },
    { id: "ACME-131", title: "월말 정산 배치의 통화 반올림 오차 고치기", project: "Billing", trackerState: "In Progress", labels: ["factory", "backend"] },
    { id: "ACME-129", title: "인보이스 번호 생성 규칙을 연도별로 초기화하기", project: "Billing", trackerState: "In Progress", labels: ["backend"] },
    { id: "ACME-136", title: "쿠폰 만료 알림 문구를 해요체로 바꾸기", project: "Billing", trackerState: "Todo", labels: ["copy"] },
    { id: "ACME-203", title: "푸시 알림 권한 요청을 첫 실행 3일 뒤로 미루기", project: "Mobile", trackerState: "In Progress", labels: ["factory", "ios"] },
    { id: "ACME-199", title: "다크 모드에서 탭 바 아이콘 대비 높이기", project: "Mobile", trackerState: "Done", labels: ["factory", "ios"] },
    { id: "ACME-197", title: "오프라인일 때 결제 내역을 캐시에서 보여 주기", project: "Mobile", trackerState: "In Review", labels: ["android", "ios"] },
    { id: "ACME-409", title: "로그인 실패 메시지에 다시 시도할 방법 적기", project: "Web Console", trackerState: "Done", labels: ["factory", "copy"] },
    { id: "ACME-127", title: "결제 실패 재시도 간격을 지수 백오프로 바꾸기", project: "Billing", trackerState: "Done", labels: ["factory", "backend"] },
    { id: "ACME-88", title: "CI 캐시 키에 lockfile 해시 넣기", project: "Platform", trackerState: "In Progress", labels: ["factory", "infra"] },
    { id: "ACME-85", title: "감사 로그 테이블에 보존 기간 컬럼 추가하기", project: "Platform", trackerState: "In Review", labels: ["infra", "db"] },
    { id: "ACME-90", title: "스테이징 DB 스냅숏을 매일 새벽에 갱신하기", project: "Platform", trackerState: "Backlog", labels: ["infra"] },
    { id: "ACME-83", title: "로그 수집기 메모리 한도를 512MB로 올리기", project: "Platform", trackerState: "Done", labels: ["factory", "infra"] },
    { id: "ACME-302", title: "실험 결과 노트북을 주간 리포트로 내보내기", project: "Research", trackerState: "In Progress", labels: ["factory"] },
    { id: "ACME-305", title: "임베딩 캐시 적중률을 대시보드에 보여 주기", project: "Research", trackerState: "Todo", labels: [] },
  ];

  /* 기본으로 보여 줄 런 상세(Human Check) */
  const runDetails = {
    1051: {
      branch: "factory/acme-416-invoice-pdf-button",
      worktree: "acme/web · acme-416",
      timeline: [
        { time: "13:21", label: "할당했어요", detail: "자동 할당 라벨 factory로 시작했어요" },
        { time: "13:21", label: "Worktree를 만들었어요", detail: "acme/web · factory/acme-416-invoice-pdf-button" },
        { time: "13:22", label: "에이전트를 시작했어요", detail: "Claude Code에 티켓 본문만 넘겼어요" },
        { time: "13:39", label: "PR #1187을 열었어요", detail: "파일 6개 · +184 −52" },
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

  /*
   * Stats: 최근 14일 [merged, check, failed].
   * 트래커 프로젝트 하나에 Mapping 하나(러너·에이전트 하나)라서, 러너별·에이전트별 수는
   * 위 mappings를 따라 트래커 프로젝트별 수를 더한 값이다. 일별 합도 트래커 프로젝트별 합과 같다.
   */
  const days = ["11/4", "11/5", "11/6", "11/7", "11/8", "11/9", "11/10", "11/11", "11/12", "11/13", "11/14", "11/15", "11/16", "11/17"];
  const stats = {
    commerce: {
      daily: [[5, 2, 1], [7, 1, 1], [6, 2, 0], [7, 2, 2], [2, 1, 0], [2, 0, 0], [8, 2, 1], [9, 2, 1], [7, 2, 1], [9, 1, 1], [8, 3, 1], [3, 1, 0], [2, 0, 1], [4, 2, 2]],
      lead: { p50: 29, p90: 58 },
      runner: [
        { name: "runner-a", merged: 40, check: 8, failed: 3, p50: 24 },
        { name: "runner-b", merged: 26, check: 9, failed: 4, p50: 35 },
        { name: "runner-c", merged: 13, check: 4, failed: 5, p50: 31 },
      ],
      project: [
        { name: "Web Console", merged: 40, check: 8, failed: 3, p50: 24 },
        { name: "Mobile", merged: 26, check: 9, failed: 4, p50: 35 },
        { name: "Billing", merged: 13, check: 4, failed: 5, p50: 31 },
      ],
      agent: [
        { name: "Claude Code", merged: 66, check: 17, failed: 7, p50: 28 },
        { name: "Codex", merged: 13, check: 4, failed: 5, p50: 31 },
      ],
    },
    labs: {
      daily: [[1, 0, 0], [1, 0, 0], [1, 1, 0], [2, 0, 0], [1, 0, 0], [0, 0, 1], [2, 0, 0], [2, 1, 0], [2, 0, 1], [3, 0, 0], [2, 1, 0], [1, 0, 0], [1, 0, 0], [1, 1, 1]],
      lead: { p50: 27, p90: 49 },
      runner: [
        { name: "runner-a", merged: 15, check: 3, failed: 1, p50: 28 },
        { name: "runner-b", merged: 5, check: 1, failed: 2, p50: 22 },
      ],
      project: [
        { name: "Platform", merged: 15, check: 3, failed: 1, p50: 28 },
        { name: "Research", merged: 5, check: 1, failed: 2, p50: 22 },
      ],
      agent: [
        { name: "Codex", merged: 15, check: 3, failed: 1, p50: 28 },
        { name: "Claude Code", merged: 5, check: 1, failed: 2, p50: 22 },
      ],
    },
  };

  const ticket = (id) => tickets.find((t) => t.id === id);
  const runner = (id) => runners.find((r) => r.id === id);
  const run = (id) => runs.find((r) => r.id === Number(id));
  const runsFor = (ticketId) => runs.filter((r) => r.ticket === ticketId).sort((a, b) => b.id - a.id);
  const workspaceOfProject = (name) => workspaces.find((w) => w.projects.includes(name));
  const workspaceOfRun = (r) => workspaceOfProject(ticket(r.ticket).project);
  const mappingFor = (project) => mappings.find((m) => m.tracker === project);

  return {
    AUTO_LABEL, agents, connections, workspaces, trackerProjects, runners, mappings, runs, tickets,
    runDetails, days, stats, ticket, runner, run, runsFor, workspaceOfProject, workspaceOfRun, mappingFor,
  };
})();

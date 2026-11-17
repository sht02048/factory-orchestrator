import type { RunnerSettingsView, SettingsPage, WorkspaceSettings } from "../settings/model";

/*
 * 온보딩(0026). 첫 진입 때 사이드바 없는 전체 화면에서 필수 설정을 끝낸다(ADR 0005·0007).
 * 다섯 단계 모두 필수이고, 앞 단계의 확인이 성공해야 다음 단계로 간다. 이전 단계로는 돌아갈 수 있다.
 * 화면 값은 Settings(0025)의 값(SettingsPage)을 그대로 쓴다. 이 파일은 DB 를 들여오지 않는다.
 */

export const ONBOARDING_STEPS = ["tracker", "github", "runner", "workspace", "mapping"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_PATH = "/onboarding";
/** 다섯 단계를 마치면 가는 곳 */
export const HOME_PATH = "/";

/**
 * 온보딩을 마치지 않았어도 들어갈 수 있는 경로. 온보딩 자신, 디자인 시스템 미리보기,
 * 트래커 webhook 같은 서버 경로다.
 */
const OPEN_PATHS = [ONBOARDING_PATH, "/ds", "/api"];

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** 온보딩을 마쳤는지와 상관없이 들어갈 수 있는 경로인지 */
export function isOpenPath(pathname: string): boolean {
  return OPEN_PATHS.some((base) => isUnder(pathname, base));
}

/** 온보딩을 마치지 않았으면 보낼 곳. 보내지 않아도 되면 null */
export function onboardingRedirect(pathname: string, complete: boolean): string | null {
  return complete || isOpenPath(pathname) ? null : ONBOARDING_PATH;
}

/**
 * 온보딩을 마쳤는지 판단하는 DB 의 설정 수. server 가 세어 넘긴다(load.ts).
 * 러너 확인 결과는 넣지 않는다. 러너가 나중에 Offline 이 돼도 앱 전체가 온보딩으로 돌아가면 안 된다.
 * Mapping 은 러너 쪽 프로젝트를 골라야 저장되고, 러너 쪽 프로젝트는 러너 확인이 러너에 닿아야 생긴다.
 */
export interface SetupCounts {
  trackerConnections: number;
  githubTokens: number;
  runners: number;
  workspaces: number;
  mappings: number;
  /**
   * 라벨만 붙이면 할당되고 런이 시작하면 티켓이 "In Progress"가 되는 트래커 프로젝트 수(0042).
   * Mapping, "In Progress" 상태, 그 트래커 연결의 Auto-assign Label 을 모두 정한 것만 센다.
   */
  autoAssignReady: number;
}

/** 다섯 단계의 결과가 모두 저장돼 있으면 온보딩을 마친 것이다 */
export function isSetupComplete(counts: SetupCounts): boolean {
  return (
    counts.trackerConnections > 0 &&
    counts.githubTokens > 0 &&
    counts.runners > 0 &&
    counts.workspaces > 0 &&
    counts.mappings > 0 &&
    counts.autoAssignReady > 0
  );
}

/**
 * Mapping 단계에서 정할 세 가지(0042). 스펙 3절 1번대로 모두 필수다. Mapping 만 정하면 라벨을 붙여도
 * 할당되지 않고(Auto-assign Label 없음), 런이 시작해도 티켓 상태가 바뀌지 않는다("In Progress" 없음).
 */
export const MAPPING_PARTS = ["mapping", "progress", "label"] as const;
export type MappingPart = (typeof MAPPING_PARTS)[number];

/**
 * 세 가지를 모두 정한 트래커 프로젝트가 있으면 빈 배열이다. 없으면 가장 많이 정한 트래커 프로젝트에서 빠진
 * 것을 돌려준다. 같으면 Mapping 을 정한 것을 앞세운다. 트래커 프로젝트가 없으면 셋 다다.
 */
export function missingMappingParts(workspace: WorkspaceSettings): MappingPart[] {
  const labeled = new Set(
    workspace.labels.flatMap((l) => (l.labelId === null ? [] : [l.connection.id])),
  );
  let best: MappingPart[] = [...MAPPING_PARTS];
  let bestMapped = false;
  for (const bound of workspace.bound) {
    const mapped = bound.mapping !== null;
    const missing = MAPPING_PARTS.filter(
      (part) =>
        (part === "mapping" && !mapped) ||
        (part === "progress" && bound.inProgressStateId === null) ||
        (part === "label" && !labeled.has(bound.connection.id)),
    );
    if (missing.length < best.length || (missing.length === best.length && mapped && !bestMapped)) {
      best = missing;
      bestMapped = mapped;
    }
  }
  return best;
}

/**
 * 러너 확인이 성공했는지. 오류 없이 닿았고, 갖추지 못한 필수 조건이 없고, GitHub 인증(할당에서 빼는 조건)을
 * 적어도 한 러너 쪽 프로젝트에서 실제로 확인했다(Q82.15). 프로젝트를 읽지 못했거나 준비된 프로젝트가 없으면
 * push 를 확인하지 못한 것이라 아직 성공이 아니다.
 */
export function runnerPassed(runner: RunnerSettingsView): boolean {
  const check = runner.check;
  return (
    check !== null &&
    check.status === "done" &&
    check.online &&
    check.error === null &&
    check.prerequisites.every((p) => p.satisfied !== false) &&
    check.prerequisites.some((p) => p.blocksAssignment && p.satisfied === true)
  );
}

/** 한 단계의 확인이 성공했는지. Settings 의 저장 함수가 연결을 확인한 뒤에만 저장하므로 저장된 값은 확인된 값이다 */
export function stepPassed(page: SettingsPage, step: OnboardingStep): boolean {
  switch (step) {
    case "tracker":
      return page.install.connections.length > 0;
    case "github":
      return page.install.githubToken;
    case "runner":
      return page.install.runners.some(runnerPassed);
    case "workspace":
      return page.workspace !== null && page.workspace.bound.length > 0;
    case "mapping":
      return page.workspace !== null && missingMappingParts(page.workspace).length === 0;
  }
}

/** 갈 수 있는 마지막 단계의 번호(0부터). 앞 단계가 모두 성공한 단계까지 갈 수 있다 */
export function reachableIndex(page: SettingsPage): number {
  const blocked = ONBOARDING_STEPS.findIndex((step) => !stepPassed(page, step));
  return blocked === -1 ? ONBOARDING_STEPS.length - 1 : blocked;
}

/**
 * 주소의 단계(1부터)를 보일 단계로 바꾼다. 없으면 아직 끝내지 않은 첫 단계이고,
 * 앞 단계를 끝내지 않은 단계는 고를 수 없어 갈 수 있는 마지막 단계로 보인다.
 */
export function resolveStep(page: SettingsPage, requested: number | undefined): number {
  const reachable = reachableIndex(page);
  if (requested === undefined) return reachable;
  const index = Math.trunc(requested) - 1;
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(index, reachable);
}

/**
 * 주소의 단계가 보일 단계와 다를 때 주소에 넣을 단계(1부터). 같으면 null 이다.
 * 보는 단계를 주소에 그대로 남겨 두어야 저장 뒤 화면 값을 다시 읽어도 지금 단계에 머문다. 단계가 없거나
 * 갈 수 없는 뒤 단계인 채로 다시 읽으면 저장으로 갈 수 있게 된 다음 단계로 넘어가, 트래커 연결을 저장하자마자
 * webhook 안내를 지나친다(0041).
 */
export function stepToPin(page: SettingsPage, requested: number | undefined): number | null {
  const shown = resolveStep(page, requested) + 1;
  return requested === shown ? null : shown;
}

/** 러너 확인에서 갖추지 못한 조건을 안내 종류로 나눈다(스펙 9절, Q43) */
export interface RunnerProblems {
  /** 러너에는 닿았지만 확인 중 오류가 났다(예: 러너 쪽 프로젝트를 읽지 못함) */
  error: string | null;
  /** 오류 없이 끝났지만 GitHub 인증을 확인한 프로젝트가 없다(프로젝트가 없거나 준비되지 않음) */
  pushUnchecked: boolean;
  /**
   * Orca 상시 서비스처럼 없으면 런을 돌릴 수 없는 조건. 1단계에서 할당에서 빼지 않는 조건이 이것이다
   * (core RunnerPrerequisite.blocksAssignment 가 거짓).
   */
  service: boolean;
  /** 비대화형 ssh 세션의 GitHub 인증(Q82.14·Q82.15). 할당에서 빼는 조건이다 */
  githubAuth: boolean;
}

export function runnerProblems(runner: RunnerSettingsView): RunnerProblems {
  const check = runner.check;
  if (check === null || check.status !== "done") {
    return { error: null, pushUnchecked: false, service: false, githubAuth: false };
  }
  const broken = check.prerequisites.filter((p) => p.satisfied === false);
  const githubAuth = broken.some((p) => p.blocksAssignment);
  return {
    error: check.online ? check.error : null,
    pushUnchecked:
      check.online &&
      !githubAuth &&
      !check.prerequisites.some((p) => p.blocksAssignment && p.satisfied === true),
    service: broken.some((p) => !p.blocksAssignment),
    githubAuth,
  };
}

/** 셸에 그대로 붙여 넣을 수 있게 값을 감싼다. 안전한 글자만 있으면 그대로 둔다 */
export function shellQuote(value: string): string {
  if (/^[\w@%+=:,./-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

const SERVICE_INSTALL = "serve service install --bind 127.0.0.1 --refuse-public --command";

/**
 * Orca 상시 서비스 설치 명령(research 0003 6·7절, runner-orca 의 안내와 같은 명령). 러너의 PATH 에 orca 가
 * 없을 수 있어 실행 파일과 --command 모두 등록한 절대 경로를 쓴다. Orca 1.4.258 에는 --supervise 플래그가 없다.
 */
export function serviceInstallCommand(orcaPath: string): string {
  const path = shellQuote(orcaPath);
  return `${path} ${SERVICE_INSTALL} ${path}`;
}

/** 경로를 아직 모를 때 보이는 설치 명령. 자리 표시 글은 화면이 메시지에서 넣는다 */
export function serviceInstallTemplate(placeholder: string): string {
  return `orca ${SERVICE_INSTALL} <${placeholder}>`;
}

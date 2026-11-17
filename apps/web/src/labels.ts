import { useTranslations } from "use-intl";

/*
 * 여러 화면이 같이 쓰는 표시 이름. 문구는 domain 메시지에 둔다(ADR 0005).
 * 어댑터나 설정이 준 값 가운데 아는 것만 메시지로 바꾸고, 모르는 값은 그대로 보인다.
 */

/** 에이전트 ID 를 이름으로 바꾼다. 모르는 에이전트는 ID 그대로 보인다 */
export function useAgentName(): (agent: string) => string {
  const t = useTranslations("domain.agent");
  return (agent) => {
    switch (agent) {
      case "claude":
      case "codex":
        return t(agent);
      default:
        return agent;
    }
  };
}

/**
 * 러너 확인 항목(core RunnerPrerequisite)의 종류. 러너 어댑터가 정한 `id` 로 가른다(runner-orca orca-runner.ts).
 * 모르는 종류는 어댑터의 `name`·`hint` 를 그대로 보인다(ADR 0008).
 */
export type PrerequisiteKind =
  | { kind: "orca-service" }
  | { kind: "github-push"; projectId: string }
  | { kind: "other" };

const GITHUB_PUSH = "github-push:";

export function prerequisiteKind(id: string): PrerequisiteKind {
  if (id === "orca-service") return { kind: "orca-service" };
  if (id.startsWith(GITHUB_PUSH))
    return { kind: "github-push", projectId: id.slice(GITHUB_PUSH.length) };
  return { kind: "other" };
}

/** github-push 항목의 러너 쪽 프로젝트 표시 이름. 찾지 못하면 null */
export function prerequisiteProject(
  id: string,
  projects: ReadonlyArray<{ id: string; displayName: string }>,
): string | null {
  const kind = prerequisiteKind(id);
  if (kind.kind !== "github-push") return null;
  return projects.find((p) => p.id === kind.projectId)?.displayName ?? null;
}

export interface PrerequisiteLabelInput {
  id: string;
  /** 어댑터가 준 이름. 모르는 종류에만 쓴다 */
  name: string;
  /** github-push 항목의 프로젝트 표시 이름. 모르면 null 이고 프로젝트 ID 를 보인다 */
  project: string | null;
}

/** 러너 확인 항목 이름. 아는 종류는 메시지로, 모르는 종류는 어댑터 문자열로 보인다 */
export function usePrerequisiteName(): (prerequisite: PrerequisiteLabelInput) => string {
  const t = useTranslations("domain.runnerPrerequisite");
  return (prerequisite) => {
    const kind = prerequisiteKind(prerequisite.id);
    switch (kind.kind) {
      case "orca-service":
        return t("orca-service");
      case "github-push":
        return t("github-push", { project: prerequisite.project ?? kind.projectId });
      case "other":
        return prerequisite.name;
    }
  };
}

/**
 * 러너 확인 항목의 안내. Orca 상시 서비스의 안내는 설치 명령이라 그대로 보인다.
 * GitHub push 의 해결 방법은 화면이 메시지로 보이므로 어댑터의 영어 안내를 보이지 않는다.
 */
export function prerequisiteHint(prerequisite: { id: string; hint: string | null }): string | null {
  return prerequisiteKind(prerequisite.id).kind === "github-push" ? null : prerequisite.hint;
}

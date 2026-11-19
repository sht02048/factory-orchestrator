import { prerequisiteKind } from "@ganger/app/prerequisites";
import { useTranslations } from "use-intl";

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

export interface PrerequisiteLabelInput {
  id: string;
  name: string;
  project: string | null;
}

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

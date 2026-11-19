import type { UsageWindowKind } from "@ganger/core";
import { useTranslations } from "use-intl";
import domain from "../messages/ko/domain.json" with { type: "json" };
import { useTime } from "./format/time";
import type { QueuedReason } from "./runs/model";

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

export function prerequisiteHint(prerequisite: { id: string; hint: string | null }): string | null {
  return prerequisiteKind(prerequisite.id).kind === "github-push" ? null : prerequisite.hint;
}

type KnownProvider = keyof typeof domain.usage.provider;

function isKnownProvider(provider: string): provider is KnownProvider {
  return Object.hasOwn(domain.usage.provider, provider);
}

export function useUsageNames(): {
  provider: (id: string) => string;
  window: (kind: UsageWindowKind) => string;
} {
  const t = useTranslations("domain.usage");
  return {
    provider: (id) => (isKnownProvider(id) ? t(`provider.${id}`) : id),
    window: (kind) => t(`window.${kind}`),
  };
}

export function useQueuedReasonText(): (reason: QueuedReason) => string {
  const t = useTranslations("domain.queuedReason");
  const names = useUsageNames();
  const { duration } = useTime();
  return (reason) => {
    switch (reason.kind) {
      case "no-capacity":
        return t("no-capacity", { runner: reason.runner });
      case "usage-limit":
        return t("usage-limit", {
          provider: names.provider(reason.provider),
          duration: duration(reason.resetsInMs),
        });
      case "starting":
      case "behind":
      case "runner-offline":
      case "project-missing":
      case "assignment-blocked":
        return t(reason.kind);
    }
  };
}

import { toAgentId, toRunnerId, toTrackerConnectionId, toTrackerProjectId } from "@ganger/core";
import type { ListRunsFilter } from "@ganger/db";
import { z } from "zod";
import { statsPeriod, statsPeriodDaysSchema } from "../stats/model";
import type { StatsDimension, StatsPeriodDays } from "../stats/model";
import { DAY_MS, calendarDay } from "../time-zone";

export interface RunConditions {
  runner?: string;
  project?: string;
  agent?: string;
  days?: StatsPeriodDays;
}

export const CONDITION_KEYS = ["runner", "project", "agent", "days"] as const;
export type ConditionKey = (typeof CONDITION_KEYS)[number];

const runnerCondition = z.string().max(200);
const projectCondition = z
  .string()
  .max(400)
  .refine((key) => parseTrackerProjectKey(key) !== null);
const agentCondition = z.string().min(1).max(200);

export const runConditionsSearch = {
  runner: runnerCondition.optional().catch(undefined),
  project: projectCondition.optional().catch(undefined),
  agent: agentCondition.optional().catch(undefined),
  days: statsPeriodDaysSchema.optional().catch(undefined),
};

export const runConditionsSchema = z.object({
  runner: runnerCondition.optional(),
  project: projectCondition.optional(),
  agent: agentCondition.optional(),
  days: statsPeriodDaysSchema.optional(),
});

export function pickConditions(search: {
  [K in keyof RunConditions]?: RunConditions[K] | undefined;
}): RunConditions {
  return {
    ...(search.runner === undefined ? {} : { runner: search.runner }),
    ...(search.project === undefined ? {} : { project: search.project }),
    ...(search.agent === undefined ? {} : { agent: search.agent }),
    ...(search.days === undefined ? {} : { days: search.days }),
  };
}

export function trackerProjectKey(connection: string, project: string): string {
  return `${encodeURIComponent(connection)}:${encodeURIComponent(project)}`;
}

export function parseTrackerProjectKey(
  key: string,
): { connection: string; project: string } | null {
  const parts = key.split(":");
  if (parts.length !== 2) return null;
  const [connection, project] = parts;
  if (connection === undefined || project === undefined) return null;
  if (connection === "" || project === "") return null;
  try {
    return { connection: decodeURIComponent(connection), project: decodeURIComponent(project) };
  } catch {
    return null;
  }
}

export function startOfCalendarDay(day: number, timeZone: string): Date {
  let low = day - DAY_MS;
  let high = day + DAY_MS;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (calendarDay(new Date(middle), timeZone) >= day) high = middle;
    else low = middle;
  }
  return new Date(high);
}

export function periodBounds(
  days: StatsPeriodDays,
  now: Date,
  timeZone: string,
): { from: Date; before: Date } {
  const period = statsPeriod(now, timeZone, days);
  return {
    from: startOfCalendarDay(period.firstDay, timeZone),
    before: startOfCalendarDay(period.lastDay + DAY_MS, timeZone),
  };
}

export type RunsFilter = Pick<ListRunsFilter, "runnerId" | "trackerProject" | "agent"> & {
  endedBetween?: { from: Date; before: Date };
};

export function toRunsFilter(conditions: RunConditions, now: Date, timeZone: string): RunsFilter {
  const project =
    conditions.project === undefined ? null : parseTrackerProjectKey(conditions.project);
  return {
    ...(conditions.runner === undefined
      ? {}
      : { runnerId: conditions.runner === "" ? null : toRunnerId(conditions.runner) }),
    ...(project === null
      ? {}
      : {
          trackerProject: {
            connection: toTrackerConnectionId(project.connection),
            project: toTrackerProjectId(project.project),
          },
        }),
    ...(conditions.agent === undefined ? {} : { agent: toAgentId(conditions.agent) }),
    ...(conditions.days === undefined
      ? {}
      : { endedBetween: periodBounds(conditions.days, now, timeZone) }),
  };
}

export function conditionsForStatsGroup(
  dimension: StatsDimension,
  key: string,
  days: StatsPeriodDays,
): RunConditions {
  switch (dimension) {
    case "runner":
      return { runner: key, days };
    case "trackerProject":
      return { project: key, days };
    case "agent":
      return { agent: key, days };
  }
}

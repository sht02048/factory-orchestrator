import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { markAllTrackersChanged } from "@ganger/db";
import { z } from "zod";
import { answerInput, denyInput, submitAnswer, submitDenial } from "@ganger/app/home/actions";
import { loadHomePage } from "@ganger/app/home/load";
import { cancelRunRequest } from "@ganger/app/run-detail/actions";
import { requestControl } from "@ganger/app/run-control";
import { loadRunDetail, requestRunLogTail } from "@ganger/app/run-detail/load";
import { loadRunnersPage } from "@ganger/app/runners/load";
import { pickConditions, runConditionsSchema } from "@ganger/app/runs/conditions";
import { loadRunsPage } from "@ganger/app/runs/load";
import { MAX_ENDED_RUNS } from "@ganger/app/runs/model";
import { loadShell } from "@ganger/app/shell/load";
import { TITLE_BAR_COOKIE, isTitleBarHidden } from "@ganger/app/shell/window-chrome";
import { loadStatsPage } from "@ganger/app/stats/load";
import { statsPeriodDaysSchema } from "@ganger/app/stats/model";
import { assignInput, submitAssignment } from "@ganger/app/tickets/assign";
import { loadTicketRuns, loadTrackerTickets } from "@ganger/app/tickets/load";
import { TIME_ZONE_COOKIE, parseTimeZone } from "@ganger/app/time-zone";
import { getAdapterRegistry, getSecretBox } from "./adapters";
import { getDatabase } from "./database";
import { getTrackerReads } from "./tracker-reads";

export const getTimeZone = createServerFn({ method: "GET" }).handler(() =>
  parseTimeZone(getCookie(TIME_ZONE_COOKIE)),
);

export const getTitleBarHidden = createServerFn({ method: "GET" }).handler(() =>
  isTitleBarHidden(getCookie(TITLE_BAR_COOKIE)),
);

export const getShell = createServerFn({ method: "GET" }).handler(() => loadShell(getDatabase()));

export const getRunnersPage = createServerFn({ method: "GET" }).handler(() =>
  loadRunnersPage(getDatabase(), new Date()),
);

export const getHomePage = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional() }))
  .handler(({ data }) =>
    loadHomePage(getDatabase(), data.ws, new Date(), parseTimeZone(getCookie(TIME_ZONE_COOKIE))),
  );

export const answerQuestion = createServerFn({ method: "POST" })
  .validator(answerInput)
  .handler(({ data }) => submitAnswer(getDatabase(), data, new Date()));

export const denyPermission = createServerFn({ method: "POST" })
  .validator(denyInput)
  .handler(({ data }) => submitDenial(getDatabase(), data, new Date()));

export const getRunsPage = createServerFn({ method: "GET" })
  .validator(
    runConditionsSchema.extend({
      ws: z.string().optional(),
      ended: z.number().int().min(1).max(MAX_ENDED_RUNS).optional(),
    }),
  )
  .handler(({ data }) =>
    loadRunsPage(
      getDatabase(),
      data.ws,
      new Date(),
      data.ended,
      pickConditions(data),
      parseTimeZone(getCookie(TIME_ZONE_COOKIE)),
    ),
  );

export const getStatsPage = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional(), days: statsPeriodDaysSchema }))
  .handler(({ data }) =>
    loadStatsPage(
      getDatabase(),
      data.ws,
      new Date(),
      parseTimeZone(getCookie(TIME_ZONE_COOKIE)),
      data.days,
    ),
  );

export const getRunDetail = createServerFn({ method: "GET" })
  .validator(z.object({ runId: z.string() }))
  .handler(({ data }) => loadRunDetail(getDatabase(), data.runId, new Date()));

export const requestRunLog = createServerFn({ method: "POST" })
  .validator(z.object({ runId: z.string() }))
  .handler(({ data }) => requestRunLogTail(getDatabase(), data.runId, new Date()));

export const cancelRun = createServerFn({ method: "POST" })
  .validator(z.object({ runId: z.string() }))
  .handler(({ data }) => cancelRunRequest(getDatabase(), data.runId, new Date()));

export const controlRun = createServerFn({ method: "POST" })
  .validator(z.object({ runId: z.string(), control: z.enum(["pause", "resume"]) }))
  .handler(({ data }) => requestControl(getDatabase(), data.runId, data.control, new Date()));

export const getTicketRuns = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional() }))
  .handler(({ data }) => loadTicketRuns(getDatabase(), data.ws, new Date()));

export const getTrackerTickets = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional() }))
  .handler(({ data }) =>
    loadTrackerTickets(
      {
        db: getDatabase(),
        secretBox: getSecretBox(),
        registry: getAdapterRegistry(),
        trackerReads: getTrackerReads(),
      },
      data.ws,
    ),
  );

export const rereadTrackers = createServerFn({ method: "POST" }).handler(() => {
  markAllTrackersChanged(getDatabase());
});

export const assignTicket = createServerFn({ method: "POST" })
  .validator(assignInput)
  .handler(({ data }) => submitAssignment(getDatabase(), data, new Date()));

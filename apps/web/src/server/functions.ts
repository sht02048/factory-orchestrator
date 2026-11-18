import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { answerInput, denyInput, submitAnswer, submitDenial } from "../home/actions";
import { loadHomePage } from "../home/load";
import { cancelRunRequest } from "../run-detail/actions";
import { loadRunDetail, requestRunLogTail } from "../run-detail/load";
import { loadRunnersPage } from "../runners/load";
import { loadRunsPage } from "../runs/load";
import { MAX_ENDED_RUNS } from "../runs/model";
import { loadShell } from "../shell/load";
import { loadStatsPage } from "../stats/load";
import { assignInput, submitAssignment } from "../tickets/assign";
import { loadTicketsPage } from "../tickets/load";
import { TIME_ZONE_COOKIE, parseTimeZone } from "../time-zone";
import { getAdapterRegistry, getSecretBox } from "./adapters";
import { getDatabase } from "./database";

export const getTimeZone = createServerFn({ method: "GET" }).handler(() =>
  parseTimeZone(getCookie(TIME_ZONE_COOKIE)),
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
    z.object({
      ws: z.string().optional(),
      ended: z.number().int().min(1).max(MAX_ENDED_RUNS).optional(),
    }),
  )
  .handler(({ data }) => loadRunsPage(getDatabase(), data.ws, new Date(), data.ended));

export const getStatsPage = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional() }))
  .handler(({ data }) =>
    loadStatsPage(getDatabase(), data.ws, new Date(), parseTimeZone(getCookie(TIME_ZONE_COOKIE))),
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

export const getTicketsPage = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional() }))
  .handler(({ data }) =>
    loadTicketsPage(
      { db: getDatabase(), secretBox: getSecretBox(), registry: getAdapterRegistry() },
      data.ws,
      new Date(),
    ),
  );

export const assignTicket = createServerFn({ method: "POST" })
  .validator(assignInput)
  .handler(({ data }) => submitAssignment(getDatabase(), data, new Date()));

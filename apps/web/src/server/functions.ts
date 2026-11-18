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

/*
 * 화면이 DB 를 읽는 server function. web 은 ssh 를 쓰지 않고 DB 만 읽는다(스펙 5절).
 * 실제 읽기는 DB 를 인자로 받는 load* 함수에 있어 테스트는 테스트 DB 로 그 함수를 부른다.
 */

/**
 * 화면 시각을 그리는 시간대. 브라우저가 남긴 쿠키에서 읽고, 없거나 시간대 이름이 아니면 UTC 다(0044).
 * 루트 loader 가 읽어 서버 렌더링과 hydration 이 같은 시간대로 그린다.
 */
export const getTimeZone = createServerFn({ method: "GET" }).handler(() =>
  parseTimeZone(getCookie(TIME_ZONE_COOKIE)),
);

export const getShell = createServerFn({ method: "GET" }).handler(() => loadShell(getDatabase()));

/** 러너는 Workspace 밖 자원이라 ws 를 받지 않는다(ADR 0006) */
export const getRunnersPage = createServerFn({ method: "GET" }).handler(() =>
  loadRunnersPage(getDatabase(), new Date()),
);

export const getHomePage = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional() }))
  .handler(({ data }) =>
    // "오늘 Merged"는 화면 시각과 같은 시간대로 자른다(0044).
    loadHomePage(getDatabase(), data.ws, new Date(), parseTimeZone(getCookie(TIME_ZONE_COOKIE))),
  );

/** 손댈 일의 질문에 답을 남긴다. worker 가 러너에 보낸다(Q61·Q82.3) */
export const answerQuestion = createServerFn({ method: "POST" })
  .validator(answerInput)
  .handler(({ data }) => submitAnswer(getDatabase(), data, new Date()));

/** 손댈 일의 권한 대기 거절을 남긴다. 허용은 러너 화면에서만 한다(Q82.4) */
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
    // 날짜 구간은 화면 시각과 같은 시간대로 자른다(0044).
    loadStatsPage(getDatabase(), data.ws, new Date(), parseTimeZone(getCookie(TIME_ZONE_COOKIE))),
  );

export const getRunDetail = createServerFn({ method: "GET" })
  .validator(z.object({ runId: z.string() }))
  .handler(({ data }) => loadRunDetail(getDatabase(), data.runId, new Date()));

/** Run 상세를 열 때 로그 꼬리를 요청한다. worker 가 ssh 로 가져와 DB 에 쓴다(Q46·Q61) */
export const requestRunLog = createServerFn({ method: "POST" })
  .validator(z.object({ runId: z.string() }))
  .handler(({ data }) => requestRunLogTail(getDatabase(), data.runId, new Date()));

/** 런 취소를 요청한다. worker 가 처리한다(Q77·Q82.8) */
export const cancelRun = createServerFn({ method: "POST" })
  .validator(z.object({ runId: z.string() }))
  .handler(({ data }) => cancelRunRequest(getDatabase(), data.runId, new Date()));

/** Tickets: 현재 Workspace 트래커 프로젝트의 티켓을 트래커 어댑터로 읽는다(0021, Q61) */
export const getTicketsPage = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional() }))
  .handler(({ data }) =>
    loadTicketsPage(
      { db: getDatabase(), secretBox: getSecretBox(), registry: getAdapterRegistry() },
      data.ws,
      new Date(),
    ),
  );

/** 수동 할당. Queued 런을 DB 에 만들고 시작은 worker 가 한다(Q53·Q60·Q61) */
export const assignTicket = createServerFn({ method: "POST" })
  .validator(assignInput)
  .handler(({ data }) => submitAssignment(getDatabase(), data, new Date()));

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadRunsPage } from "../runs/load";
import { loadShell } from "../shell/load";
import { loadStatsPage } from "../stats/load";
import { getDatabase } from "./database";

/*
 * 화면이 DB 를 읽는 server function. web 은 ssh 를 쓰지 않고 DB 만 읽는다(스펙 5절).
 * 실제 읽기는 DB 를 인자로 받는 load* 함수에 있어 테스트는 테스트 DB 로 그 함수를 부른다.
 */

export const getShell = createServerFn({ method: "GET" }).handler(() => loadShell(getDatabase()));

export const getRunsPage = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional() }))
  .handler(({ data }) => loadRunsPage(getDatabase(), data.ws, new Date()));

export const getStatsPage = createServerFn({ method: "GET" })
  .validator(z.object({ ws: z.string().optional() }))
  .handler(({ data }) => loadStatsPage(getDatabase(), data.ws, new Date()));

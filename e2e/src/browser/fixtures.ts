import {
  toTicketKey,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
} from "@factory/core";
import type { TrackerTicket } from "@factory/core";
import { toWorkspaceId } from "@factory/db";

/*
 * 브라우저 시험(티켓 0039)의 고정 값. 시험 파일과, web 개발 서버가 읽는 가짜 어댑터 등록표
 * (fake-adapters.ts)가 함께 쓴다. 둘은 같은 프로세스지만 모듈 그래프가 달라(vitest 와 vite SSR)
 * 객체를 넘기지 않고 이 값으로 같은 상태를 만든다. 가상 값만 쓴다(acme, example.com).
 */

export const fakeKind = toTrackerKind("fake");
export const connection = toTrackerConnectionId("conn-acme");
export const workspaceId = toWorkspaceId("ws-acme");
export const trackerProject = toTrackerProjectId("tp-web");

/** Tickets 화면에서 수동 할당하는 티켓. 트래커(가짜 어댑터)에만 있고 런은 없다 */
export const unassignedTicket: TrackerTicket = {
  key: toTicketKey("ACME-3"),
  title: "Add a health check endpoint",
  body: "Return 200 from /health.",
  url: "https://tracker.example.com/ACME-3",
  labels: [],
  project: { id: trackerProject, name: "Web" },
  state: { id: toTrackerStateId("todo"), name: "Todo", category: "unstarted" },
  updatedAt: new Date("2026-11-17T09:00:00Z"),
};

export const trackerTickets: ReadonlyArray<TrackerTicket> = [unassignedTicket];

import {
  toTicketKey,
  toTrackerConnectionId,
  toTrackerKind,
  toTrackerProjectId,
  toTrackerStateId,
} from "@ganger/core";
import type { TrackerTicket } from "@ganger/core";
import { toWorkspaceId } from "@ganger/db";

export const fakeKind = toTrackerKind("fake");
export const connection = toTrackerConnectionId("conn-acme");
export const workspaceId = toWorkspaceId("ws-acme");
export const trackerProject = toTrackerProjectId("tp-web");

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

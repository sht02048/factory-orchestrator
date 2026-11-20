import { silentLogger } from "@ganger/log/testing";
import { toDeliveryId, toTicketKey, toTrackerStateId } from "@ganger/core";
import type { TrackerTicket } from "@ganger/core";
import {
  addTrackerProject,
  createAutoAssignLabel,
  removeTrackerProject,
} from "@ganger/app/settings/actions";
import { loadSettingsPage } from "@ganger/app/settings/load";
import { submitAssignment } from "@ganger/app/tickets/assign";
import { loadTicketsPage } from "@ganger/app/tickets/load";
import { TrackerReads } from "@ganger/app/tracker-reads";
import { markAllTrackersChanged, trackerReadGeneration } from "@ganger/db";
import { GANGER_YELLOW_HEX } from "@ganger/ui/brand-color";
import { describe, expect, it } from "vitest";
import { receiveTrackerWebhook } from "../webhooks/receive";
import { commerce, connection, now, setupTickets, webProject, webRepo } from "./test-fixtures";

function cachedSetup() {
  const fixture = setupTickets();
  const context = { ...fixture.context, trackerReads: new TrackerReads({ now: () => 0 }) };
  const stateOf = async (key: string) =>
    (await loadTicketsPage(context, commerce, now)).tickets.find((t) => t.key === key)?.trackerState
      .name;
  const moveToDone = (key: string) => {
    const ticket = fixture.tracker.tickets.get(toTicketKey(key));
    if (ticket === undefined) throw new Error(`no ticket ${key}`);
    const done: TrackerTicket = {
      ...ticket,
      state: { id: toTrackerStateId("st-done"), name: "Done", category: "completed" },
    };
    fixture.tracker.addTicket(done);
  };
  return { ...fixture, context, stateOf, moveToDone };
}

describe("담아 둔 트래커 읽기를 지우는 경로(0122)", () => {
  it("담아 둔 동안은 트래커에서 바뀐 상태를 보이지 않는다", async () => {
    const { stateOf, moveToDone } = cachedSetup();
    expect(await stateOf("ACME-1")).toBe("Todo");
    moveToDone("ACME-1");
    expect(await stateOf("ACME-1")).toBe("Todo");
  });

  it("Ganger 에서 할당하면 다음 Tickets 읽기는 트래커의 새 값을 보인다", async () => {
    const { db, stateOf, moveToDone } = cachedSetup();
    await stateOf("ACME-1");
    moveToDone("ACME-1");

    const assigned = submitAssignment(
      db,
      {
        connection,
        ticketKey: "ACME-6",
        ticketTitle: "ACME-6 제목",
        trackerProject: webProject,
        runnerProject: webRepo,
        runnerId: null,
        agent: "claude",
      },
      now,
    );
    expect(assigned.ok).toBe(true);
    expect(await stateOf("ACME-1")).toBe("Done");
  });

  it("트래커 webhook 을 받으면 다음 Tickets 읽기는 트래커의 새 값을 보인다", async () => {
    const { db, context, tracker, stateOf, moveToDone } = cachedSetup();
    await stateOf("ACME-1");
    moveToDone("ACME-1");
    tracker.verifyWebhookWith = ({ now: receivedAt }) => ({
      ok: true,
      event: {
        deliveryId: toDeliveryId("delivery-1"),
        kind: "ticket.updated",
        ticketKey: toTicketKey("ACME-1"),
        projectId: webProject,
        labelIds: [],
        previousLabelIds: [],
        receivedAt,
      },
    });

    const response = await receiveTrackerWebhook(
      { db, secretBox: context.secretBox, registry: context.registry, logger: silentLogger },
      connection,
      { headers: new Headers(), body: null },
      now,
    );
    expect(response.status).toBe(200);
    expect(await stateOf("ACME-1")).toBe("Done");
  });

  it("Linear에서 다시 읽기를 누르면 다음 Tickets 읽기는 트래커의 새 값을 보인다", async () => {
    const { db, stateOf, moveToDone } = cachedSetup();
    await stateOf("ACME-1");
    moveToDone("ACME-1");
    markAllTrackersChanged(db);
    expect(await stateOf("ACME-1")).toBe("Done");
  });

  it("바로 할당 라벨을 만들면 다음 Settings 읽기는 새 라벨을 보인다", async () => {
    const { context, tracker } = cachedSetup();
    tracker.labels.set(webProject, []);
    const labelNames = async () =>
      (await loadSettingsPage(context, commerce, now)).workspace?.labels.flatMap((group) =>
        group.labels.ok ? group.labels.items.map((label) => label.name) : [],
      ) ?? [];
    expect(await labelNames()).toEqual([]);

    const created = await createAutoAssignLabel(
      context,
      { ws: commerce, connectionId: connection },
      GANGER_YELLOW_HEX,
    );
    expect(created).toMatchObject({ ok: true, created: true });
    expect(await labelNames()).toContain(created.ok ? created.name : "");
  });

  it("트래커 프로젝트를 더하거나 빼면 그 연결의 담아 둔 읽기를 지운다(Query 스펙 0003)", () => {
    const { db, context } = cachedSetup();
    const before = trackerReadGeneration(db, connection);
    expect(
      addTrackerProject(context, {
        ws: commerce,
        connectionId: connection,
        projectId: "tp-new",
        name: "New",
      }),
    ).toEqual({ ok: true });
    expect(
      removeTrackerProject(context, {
        ws: commerce,
        connectionId: connection,
        projectId: "tp-new",
      }),
    ).toEqual({ ok: true });
    expect(trackerReadGeneration(db, connection)).toBe(before + 2);
  });
});

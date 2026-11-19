import { AdapterRegistry } from "@ganger/core";
import type { Page, Paged, TrackerProjectId, TrackerTicket } from "@ganger/core";
import { FakeTracker } from "@ganger/core/testing";
import { SecretBox, parseBootConfig } from "@ganger/db";
import type { RunnerEnrollments } from "@ganger/app/runner-setup/enrollment";
import type { GangerSsh } from "@ganger/app/runner-setup/ganger-ssh";
import type { ThisMac } from "@ganger/app/runner-setup/model";
import { fakeEnrollmentWorld } from "./fake-enrollment.js";
import { fakeKind, trackerProject, trackerTickets } from "./fixtures.js";
import { fakeThisMac } from "./fake-this-mac.js";

export const TRACKER_DELAY_MS = 1_500;

const slow = () => new Promise((resolve) => setTimeout(resolve, TRACKER_DELAY_MS));

class SlowTracker extends FakeTracker {
  override async listProjectTickets(
    projectId: TrackerProjectId,
    page?: Page,
  ): Promise<Paged<TrackerTicket>> {
    await slow();
    return super.listProjectTickets(projectId, page);
  }
}

let registry: AdapterRegistry | undefined;
let secretBox: SecretBox | undefined;

export function getAdapterRegistry(): AdapterRegistry {
  if (registry === undefined) {
    const tracker = new SlowTracker(fakeKind);
    for (const ticket of trackerTickets) tracker.addTicket(ticket);
    tracker.projects.push({
      id: trackerProject,
      name: "Web",
      url: "https://tracker.example.com/projects/web",
    });
    registry = new AdapterRegistry().registerTracker({ kind: fakeKind, create: () => tracker });
  }
  return registry;
}

export function getSecretBox(): SecretBox {
  secretBox ??= new SecretBox(parseBootConfig(process.env).encryptionKey);
  return secretBox;
}

export function getThisMac(): ThisMac {
  return fakeThisMac();
}

export function getGangerSsh(): GangerSsh | null {
  return fakeEnrollmentWorld().ssh;
}

export function getRunnerEnrollments(): RunnerEnrollments {
  return fakeEnrollmentWorld().enrollments;
}

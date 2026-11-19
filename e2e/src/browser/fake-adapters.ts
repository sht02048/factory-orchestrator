import { AdapterRegistry } from "@ganger/core";
import { FakeTracker } from "@ganger/core/testing";
import { SecretBox, parseBootConfig } from "@ganger/db";
import type { ThisMac } from "@ganger/app/runner-setup/model";
import { fakeKind, trackerProject, trackerTickets } from "./fixtures.js";
import { fakeThisMac } from "./fake-this-mac.js";

let registry: AdapterRegistry | undefined;
let secretBox: SecretBox | undefined;

export function getAdapterRegistry(): AdapterRegistry {
  if (registry === undefined) {
    const tracker = new FakeTracker(fakeKind);
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

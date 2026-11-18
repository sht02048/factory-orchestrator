import { AdapterRegistry } from "@factory/core";
import { FakeTracker } from "@factory/core/testing";
import { SecretBox, parseBootConfig } from "@factory/db";
import { fakeKind, trackerProject, trackerTickets } from "./fixtures.js";

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

import { AdapterRegistry, toTrackerProjectId } from "@ganger/core";
import { FakeTracker } from "@ganger/core/testing";
import { SecretBox, parseBootConfig } from "@ganger/db";
import { fakeKind, trackerProject } from "./browser/fixtures.js";

let registry: AdapterRegistry | undefined;
let secretBox: SecretBox | undefined;

export function getAdapterRegistry(): AdapterRegistry {
  if (registry === undefined) {
    const tracker = new FakeTracker(fakeKind);
    tracker.projects.push(
      { id: trackerProject, name: "Web", url: "https://tracker.example.com/web" },
      { id: toTrackerProjectId("tp-api"), name: "API", url: "https://tracker.example.com/api" },
    );
    registry = new AdapterRegistry().registerTracker({ kind: fakeKind, create: () => tracker });
  }
  return registry;
}

export function getSecretBox(): SecretBox {
  secretBox ??= new SecretBox(parseBootConfig(process.env).encryptionKey);
  return secretBox;
}

import { AdapterRegistry, toLabelId, toTrackerProjectId, toTrackerStateId } from "@ganger/core";
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
    for (const project of [trackerProject, toTrackerProjectId("tp-api")]) {
      tracker.states.set(project, [
        { id: toTrackerStateId("todo"), name: "Todo", category: "unstarted" },
        { id: toTrackerStateId("in-progress"), name: "In Progress", category: "started" },
      ]);
    }
    tracker.labels.set(trackerProject, [
      { id: toLabelId("label-api"), name: "api" },
      { id: toLabelId("label-infra"), name: "infra" },
    ]);
    registry = new AdapterRegistry().registerTracker({ kind: fakeKind, create: () => tracker });
  }
  return registry;
}

export function getSecretBox(): SecretBox {
  secretBox ??= new SecretBox(parseBootConfig(process.env).encryptionKey);
  return secretBox;
}

export { getThisMac } from "./browser/fake-adapters.js";

import { AdapterRegistry } from "@ganger/core";
import { githubCodeHostFactory } from "@ganger/codehost-github";
import { linearTrackerFactory } from "@ganger/tracker-linear";

export function createAdapterRegistry(): AdapterRegistry {
  return new AdapterRegistry()
    .registerTracker(linearTrackerFactory)
    .registerCodeHost(githubCodeHostFactory);
}

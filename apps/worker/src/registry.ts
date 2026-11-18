import { AdapterRegistry } from "@ganger/core";
import { githubCodeHostFactory } from "@ganger/codehost-github";
import { orcaRunnerFactory } from "@ganger/runner-orca";
import { linearTrackerFactory } from "@ganger/tracker-linear";

export function createAdapterRegistry(): AdapterRegistry {
  return new AdapterRegistry()
    .registerRunner(orcaRunnerFactory)
    .registerTracker(linearTrackerFactory)
    .registerCodeHost(githubCodeHostFactory);
}

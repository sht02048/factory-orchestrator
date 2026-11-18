import { AdapterRegistry } from "@factory/core";
import { githubCodeHostFactory } from "@factory/codehost-github";
import { orcaRunnerFactory } from "@factory/runner-orca";
import { linearTrackerFactory } from "@factory/tracker-linear";

export function createAdapterRegistry(): AdapterRegistry {
  return new AdapterRegistry()
    .registerRunner(orcaRunnerFactory)
    .registerTracker(linearTrackerFactory)
    .registerCodeHost(githubCodeHostFactory);
}

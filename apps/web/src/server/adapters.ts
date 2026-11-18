import { AdapterRegistry } from "@ganger/core";
import { githubCodeHostFactory } from "@ganger/codehost-github";
import { SecretBox, parseBootConfig } from "@ganger/db";
import { linearTrackerFactory } from "@ganger/tracker-linear";

let registry: AdapterRegistry | undefined;
let secretBox: SecretBox | undefined;

export function getAdapterRegistry(): AdapterRegistry {
  registry ??= new AdapterRegistry()
    .registerTracker(linearTrackerFactory)
    .registerCodeHost(githubCodeHostFactory);
  return registry;
}

export function getSecretBox(): SecretBox {
  secretBox ??= new SecretBox(parseBootConfig(process.env).encryptionKey);
  return secretBox;
}

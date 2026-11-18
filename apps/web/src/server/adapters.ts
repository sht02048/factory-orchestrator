import { AdapterRegistry } from "@factory/core";
import { githubCodeHostFactory } from "@factory/codehost-github";
import { SecretBox, parseBootConfig } from "@factory/db";
import { linearTrackerFactory } from "@factory/tracker-linear";

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

import type { AdapterRegistry } from "@factory/core";
import { SecretBox, parseBootConfig } from "@factory/db";
import { demoWorld } from "./world.js";

let registry: AdapterRegistry | undefined;
let secretBox: SecretBox | undefined;

export function getAdapterRegistry(): AdapterRegistry {
  registry ??= demoWorld().registry();
  return registry;
}

export function getSecretBox(): SecretBox {
  secretBox ??= new SecretBox(parseBootConfig(process.env).encryptionKey);
  return secretBox;
}

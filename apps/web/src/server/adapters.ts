import { createAdapterRegistry } from "@ganger/app/adapters";
import type { AdapterRegistry } from "@ganger/core";
import { SecretBox, parseBootConfig } from "@ganger/db";

let registry: AdapterRegistry | undefined;
let secretBox: SecretBox | undefined;

export function getAdapterRegistry(): AdapterRegistry {
  registry ??= createAdapterRegistry();
  return registry;
}

export function getSecretBox(): SecretBox {
  secretBox ??= new SecretBox(parseBootConfig(process.env).encryptionKey);
  return secretBox;
}

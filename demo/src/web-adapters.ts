import type { AdapterRegistry } from "@ganger/core";
import { SecretBox, parseBootConfig } from "@ganger/db";
import type { ThisMac } from "@ganger/app/runner-setup/model";
import { demoThisMac } from "./this-mac.js";
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

export function getThisMac(): ThisMac {
  return demoThisMac();
}

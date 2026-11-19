import { isAbsolute } from "node:path";
import { HOME_ENV } from "@ganger/cli/home";
import { createAdapterRegistry } from "@ganger/app/adapters";
import type { ThisMac } from "@ganger/app/runner-setup/model";
import { localThisMac } from "@ganger/app/runner-setup/this-mac";
import type { AdapterRegistry } from "@ganger/core";
import { SecretBox, parseBootConfig } from "@ganger/db";
import { z } from "zod";

let registry: AdapterRegistry | undefined;
let secretBox: SecretBox | undefined;
let thisMac: ThisMac | undefined;

export function getAdapterRegistry(): AdapterRegistry {
  registry ??= createAdapterRegistry();
  return registry;
}

export function getSecretBox(): SecretBox {
  secretBox ??= new SecretBox(parseBootConfig(process.env).encryptionKey);
  return secretBox;
}

const gangerHomeSchema = z.string().trim().min(1).refine(isAbsolute).optional().catch(undefined);

export function getThisMac(): ThisMac {
  thisMac ??= localThisMac({ gangerHome: gangerHomeSchema.parse(process.env[HOME_ENV]) });
  return thisMac;
}

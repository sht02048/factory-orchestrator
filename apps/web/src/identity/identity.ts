import { z } from "zod";
import rootPackage from "../../../../package.json" with { type: "json" };

export const PRODUCT_NAME = "factory-orchestrator";

export const WEB_ACCESS = ["allowed", "host-not-allowed"] as const;
export type WebAccess = (typeof WEB_ACCESS)[number];

export const identitySchema = z.object({
  product: z.literal(PRODUCT_NAME),
  version: z.string(),
  instanceId: z.string(),
  webAccess: z.enum(WEB_ACCESS).catch("host-not-allowed"),
});
export type Identity = z.infer<typeof identitySchema>;

export const PRODUCT_VERSION = z.object({ version: z.string() }).parse(rootPackage).version;

export function identityOf(instanceId: string, webAccess: WebAccess): Identity {
  return { product: PRODUCT_NAME, version: PRODUCT_VERSION, instanceId, webAccess };
}

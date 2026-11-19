import { z } from "zod";

export const DESKTOP_UPDATES_GLOBAL = "gangerDesktopUpdates";

export const MANUAL_REASONS = ["outside-applications", "no-permission"] as const;
export type ManualReason = (typeof MANUAL_REASONS)[number];

const release = { version: z.string(), notesUrl: z.string() };

export const updateCheckSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("idle") }),
  z.object({ kind: z.literal("checking") }),
  z.object({ kind: z.literal("latest") }),
  z.object({ kind: z.literal("failed") }),
  z.object({ kind: z.literal("unavailable") }),
  z.object({ kind: z.literal("downloading"), ...release }),
  z.object({ kind: z.literal("ready"), ...release }),
  z.object({ kind: z.literal("manual"), reason: z.enum(MANUAL_REASONS), ...release }),
]);
export type UpdateCheck = z.infer<typeof updateCheckSchema>;

export const updateToastSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), ...release }),
  z.object({ kind: z.literal("updated"), ...release }),
]);
export type UpdateToast = z.infer<typeof updateToastSchema>;

export const SERVER_KINDS = ["app", "external", "remote"] as const;
export type ServerKind = (typeof SERVER_KINDS)[number];

export const updateViewSchema = z.object({
  appVersion: z.string(),
  server: z.object({ kind: z.enum(SERVER_KINDS), version: z.string().nullable() }),
  autoUpdate: z.boolean(),
  lastCheckedAt: z.string().nullable(),
  latest: z.object(release).nullable(),
  check: updateCheckSchema,
  toast: updateToastSchema.nullable(),
});
export type UpdateView = z.infer<typeof updateViewSchema>;

export const UPDATE_ACTIONS = [
  "restart",
  "later",
  "dismiss-updated",
  "check-now",
  "auto-on",
  "auto-off",
] as const;
export type UpdateAction = (typeof UPDATE_ACTIONS)[number];

export function isUpdateAction(value: unknown): value is UpdateAction {
  return typeof value === "string" && UPDATE_ACTIONS.some((action) => action === value);
}

export function serverVersionDiffers(view: UpdateView): boolean {
  return view.server.version !== null && view.server.version !== view.appVersion;
}

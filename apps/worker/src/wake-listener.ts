import { isWorkerWakeEnabled } from "@ganger/core";
import { z } from "zod";

const wakeMessageSchema = z.object({ type: z.literal("wake") });

export interface WakeSource {
  env: Readonly<Record<string, string | undefined>>;
  connected: boolean;
  on(event: "message", listener: (message: unknown) => void): unknown;
}

export function listenForWake(source: WakeSource, wake: () => void): boolean {
  if (!isWorkerWakeEnabled(source.env) || !source.connected) return false;
  source.on("message", (message) => {
    if (wakeMessageSchema.safeParse(message).success) wake();
  });
  return true;
}

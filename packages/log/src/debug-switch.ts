import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const LOG_SWITCH_FILE = "logging.json";

const debugSwitchSchema = z.object({ debug: z.boolean() });

export function debugSwitchPath(home: string): string {
  return join(home, LOG_SWITCH_FILE);
}

export function readDebugSwitch(home: string): boolean {
  try {
    const parsed = debugSwitchSchema.safeParse(
      JSON.parse(readFileSync(debugSwitchPath(home), "utf8")),
    );
    return parsed.success && parsed.data.debug;
  } catch {
    return false;
  }
}

export function writeDebugSwitch(home: string, debug: boolean): void {
  mkdirSync(home, { recursive: true });
  const path = debugSwitchPath(home);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ debug })}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

export function watchDebugSwitch(home: string): () => boolean {
  let seen: string | null = null;
  let debug = false;
  return () => {
    let stamp: string;
    try {
      const stat = statSync(debugSwitchPath(home), { bigint: true });
      stamp = `${stat.ino}:${stat.mtimeNs}:${stat.size}`;
    } catch {
      seen = null;
      debug = false;
      return false;
    }
    if (stamp !== seen) {
      seen = stamp;
      debug = readDebugSwitch(home);
    }
    return debug;
  };
}

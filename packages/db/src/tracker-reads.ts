import type { TrackerConnectionId } from "@ganger/core";
import { eq } from "drizzle-orm";
import { inTransaction } from "./database.js";
import type { Database } from "./database.js";
import { markTrackerChanged } from "./change-events.js";
import { trackerConnections, trackerReadGenerations } from "./schema.js";

export function trackerReadGeneration(db: Database, connection: TrackerConnectionId): number {
  return (
    db
      .select({ generation: trackerReadGenerations.generation })
      .from(trackerReadGenerations)
      .where(eq(trackerReadGenerations.trackerConnectionId, connection))
      .get()?.generation ?? 0
  );
}

export function markAllTrackersChanged(db: Database, now: Date = new Date()): void {
  inTransaction(db, () => {
    for (const { id } of db.select({ id: trackerConnections.id }).from(trackerConnections).all())
      markTrackerChanged(db, id, now);
  });
}

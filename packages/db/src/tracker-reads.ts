import type { TrackerConnectionId } from "@ganger/core";
import { eq, sql } from "drizzle-orm";
import type { Database } from "./database.js";
import { trackerConnections, trackerReadGenerations } from "./schema.js";

export function markTrackerChanged(db: Database, connection: TrackerConnectionId): void {
  db.insert(trackerReadGenerations)
    .values({ trackerConnectionId: connection, generation: 1 })
    .onConflictDoUpdate({
      target: trackerReadGenerations.trackerConnectionId,
      set: { generation: sql`${trackerReadGenerations.generation} + 1` },
    })
    .run();
}

export function trackerReadGeneration(db: Database, connection: TrackerConnectionId): number {
  return (
    db
      .select({ generation: trackerReadGenerations.generation })
      .from(trackerReadGenerations)
      .where(eq(trackerReadGenerations.trackerConnectionId, connection))
      .get()?.generation ?? 0
  );
}

export function markAllTrackersChanged(db: Database): void {
  for (const { id } of db.select({ id: trackerConnections.id }).from(trackerConnections).all())
    markTrackerChanged(db, id);
}

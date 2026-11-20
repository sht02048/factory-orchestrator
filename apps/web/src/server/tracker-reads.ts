import { TrackerReads } from "@ganger/app/tracker-reads";

let trackerReads: TrackerReads | undefined;

export function getTrackerReads(): TrackerReads {
  trackerReads ??= new TrackerReads();
  return trackerReads;
}

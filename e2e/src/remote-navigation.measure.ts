import { expect, it } from "vitest";
import {
  START_PATH,
  measureNavigation,
  parseMilliseconds,
  parseRoundTrips,
  rowsTable,
} from "./measure-core.ts";
import { navigationWorkspace, startNavigationWorld } from "./navigation-world.ts";

const roundTrips = parseRoundTrips(process.env["MEASURE_RTT"] ?? "0,100,200");
const trackerDelay = parseMilliseconds(process.env["MEASURE_TRACKER_DELAY"] ?? "500", "delay");
const repeat = parseMilliseconds(process.env["MEASURE_REPEAT"] ?? "3", "repeat");

it("원격 왕복과 느린 트래커로 레일 이동 시간을 잰다(0122)", async () => {
  const world = await startNavigationWorld(trackerDelay);
  try {
    const startUrl = new URL(START_PATH, world.baseUrl);
    startUrl.searchParams.set("ws", navigationWorkspace);
    const rows = await measureNavigation({
      startUrl: startUrl.href,
      roundTrips,
      repeat: Math.max(1, repeat),
      warm: true,
    });
    expect(rows).toHaveLength(roundTrips.length * 3 * 6);
    process.stdout.write(
      `${rowsTable(
        `navigation from the rail, dev server with tracker delay ${trackerDelay}ms, median of ${repeat}`,
        rows,
      )}\n`,
    );
  } finally {
    await world.close();
  }
});

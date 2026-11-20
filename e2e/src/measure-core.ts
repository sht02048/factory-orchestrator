import { chromium } from "playwright-core";
import type { NavigationRound, NavigationSample } from "./navigation-timing.ts";
import { emulateRoundTrip, measureRail, waitForRouterIdle } from "./navigation-timing.ts";

export const START_PATH = "/runs/measure-start";
const rounds: ReadonlyArray<NavigationRound> = ["first", "again", "hover"];

export interface MeasureRow {
  rtt: number;
  round: NavigationRound;
  screen: string;
  medianMs: number;
  serverCalls: string;
}

export interface MeasureOptions {
  startUrl: string;
  roundTrips: ReadonlyArray<number>;
  repeat: number;
  warm: boolean;
}

export function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function parseMilliseconds(raw: string, flag: string): number {
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0) throw new Error(`${flag} must be whole milliseconds`);
  return value;
}

export function parseRoundTrips(raw: string): number[] {
  return raw.split(",").map((value) => parseMilliseconds(value, "round trip"));
}

export async function measureNavigation(options: MeasureOptions): Promise<MeasureRow[]> {
  const rows: MeasureRow[] = [];
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    if (options.warm) {
      const warm = await browser.newPage({ locale: "ko-KR" });
      warm.setDefaultTimeout(110_000);
      await warm.goto(options.startUrl);
      await waitForRouterIdle(warm, START_PATH);
      await measureRail(warm, "first");
      await warm.close();
    }
    for (const rtt of options.roundTrips) {
      const results = new Map<NavigationRound, NavigationSample[][]>(rounds.map((r) => [r, []]));
      for (let i = 0; i < options.repeat; i += 1) {
        for (const plan of [["first", "again"], ["hover"]] as const) {
          const context = await browser.newContext({ locale: "ko-KR" });
          const page = await context.newPage();
          page.setDefaultTimeout(60_000);
          await emulateRoundTrip(page, rtt);
          await page.goto(options.startUrl);
          await waitForRouterIdle(page, START_PATH);
          for (const round of plan) results.get(round)?.push(await measureRail(page, round));
          await context.close();
        }
      }
      for (const round of rounds) {
        const runs = results.get(round) ?? [];
        const first = runs[0] ?? [];
        for (const [index, sample] of first.entries()) {
          const samples = runs.map((run) => run[index]).filter((s) => s !== undefined);
          rows.push({
            rtt,
            round,
            screen: sample.screen,
            medianMs: median(samples.map((s) => s.ms)),
            serverCalls: sample.serverCalls.map((call) => `${call.name} ${call.ms}ms`).join(", "),
          });
        }
      }
    }
  } finally {
    await browser.close();
  }
  return rows;
}

export function rowsTable(title: string, rows: ReadonlyArray<MeasureRow>): string {
  return [
    title,
    "| round trip | round | screen | click → drawn (ms) | server functions during click |",
    "| ---: | --- | --- | ---: | --- |",
    ...rows.map(
      (row) =>
        `| ${row.rtt} | ${row.round} | ${row.screen} | ${row.medianMs} | ${row.serverCalls || "-"} |`,
    ),
  ].join("\n");
}

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright-core";
import { measureRail, waitForRouterIdle } from "./navigation-timing.ts";
import type { NavigationRound, NavigationSample } from "./navigation-timing.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:3000" },
    repeat: { type: "string", default: "3" },
    client: { type: "string" },
    json: { type: "boolean", default: false },
  },
  strict: true,
});

const repeat = Number(values.repeat);
if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat must be a positive integer");

function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const START_PATH = "/runs/measure-start";
const rounds: ReadonlyArray<NavigationRound> = ["first", "again", "hover"];
const results = new Map<NavigationRound, NavigationSample[][]>(rounds.map((r) => [r, []]));

const browser = await chromium.launch({ channel: "chrome" });
try {
  for (let i = 0; i < repeat; i += 1) {
    for (const plan of [["first", "again"], ["hover"]] as const) {
      const context = await browser.newContext({ locale: "ko-KR" });
      const page = await context.newPage();
      await page.goto(new URL(START_PATH, values.url).href);
      await waitForRouterIdle(page, START_PATH);
      for (const round of plan) results.get(round)?.push(await measureRail(page, round));
      await context.close();
    }
  }
} finally {
  await browser.close();
}

interface Row {
  round: NavigationRound;
  screen: string;
  medianMs: number;
  serverCalls: string;
}

const rows: Row[] = [];
for (const round of rounds) {
  const runs = results.get(round) ?? [];
  const first = runs[0] ?? [];
  for (const [index, sample] of first.entries()) {
    const samples = runs.map((run) => run[index]).filter((s) => s !== undefined);
    rows.push({
      round,
      screen: sample.screen,
      medianMs: median(samples.map((s) => s.ms)),
      serverCalls: sample.serverCalls.map((call) => `${call.name} ${call.ms}ms`).join(", "),
    });
  }
}

function clientChunks(dir: string): { file: string; bytes: number; gzip: number }[] {
  const assets = join(dir, "assets");
  return readdirSync(assets)
    .filter((file) => file.endsWith(".js"))
    .map((file) => {
      const content = readFileSync(join(assets, file));
      return { file, bytes: statSync(join(assets, file)).size, gzip: gzipSync(content).length };
    })
    .sort((a, b) => b.bytes - a.bytes);
}

const chunks = values.client === undefined ? [] : clientChunks(values.client);

if (values.json) {
  console.log(JSON.stringify({ url: values.url, repeat, rows, chunks }, null, 2));
} else {
  console.log(`navigation from the rail, ${values.url}, median of ${repeat}`);
  console.log("| round | screen | click → drawn (ms) | server functions during click |");
  console.log("| --- | --- | ---: | --- |");
  for (const row of rows) {
    console.log(`| ${row.round} | ${row.screen} | ${row.medianMs} | ${row.serverCalls || "-"} |`);
  }
  if (chunks.length > 0) {
    const kb = (n: number) => (n / 1024).toFixed(1);
    const total = chunks.reduce((sum, c) => sum + c.bytes, 0);
    const totalGzip = chunks.reduce((sum, c) => sum + c.gzip, 0);
    console.log(
      `\nclient JS: ${chunks.length} chunks, ${kb(total)} KiB (${kb(totalGzip)} KiB gzip)`,
    );
    console.log("| chunk | KiB | gzip KiB |");
    console.log("| --- | ---: | ---: |");
    for (const chunk of chunks.slice(0, 15)) {
      console.log(`| ${chunk.file} | ${kb(chunk.bytes)} | ${kb(chunk.gzip)} |`);
    }
  }
}

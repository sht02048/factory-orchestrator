import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { START_PATH, measureNavigation, parseRoundTrips, rowsTable } from "./measure-core.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:3000" },
    repeat: { type: "string", default: "3" },
    rtt: { type: "string", default: "0" },
    client: { type: "string" },
    json: { type: "boolean", default: false },
  },
  strict: true,
});

const repeat = Number(values.repeat);
if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat must be a positive integer");

const rows = await measureNavigation({
  startUrl: new URL(START_PATH, values.url).href,
  roundTrips: parseRoundTrips(values.rtt),
  repeat,
  warm: false,
});

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
  console.log(rowsTable(`navigation from the rail, ${values.url}, median of ${repeat}`, rows));
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

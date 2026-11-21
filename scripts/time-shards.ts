import { stripVTControlCharacters } from "node:util";

export interface ShardFile {
  id: string;
  path: string;
}

export const BROWSER_TEST_TIMES_FILE = new URL("./browser-test-times.json", import.meta.url);

const PASSED_BROWSER_FILE = /✓\s+(e2e|demo)\s+(src\/\S+\.test\.ts)\s+\([^)]*\)\s+(\d+)ms/;
const CARET_COLOR_CODE = /\^\[\[[0-9;]*m/g;

export function parseFileTimes(value: unknown): Map<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("browser test times must be an object of file path to milliseconds");
  }
  const times = new Map<string, number>();
  for (const [path, ms] of Object.entries(value)) {
    if (typeof ms !== "number" || !Number.isInteger(ms) || ms <= 0) {
      throw new Error(`browser test time for ${path} must be a positive integer`);
    }
    times.set(path, ms);
  }
  return times;
}

function estimateFor(files: readonly ShardFile[], times: ReadonlyMap<string, number>): number {
  const known = files.flatMap((file) => times.get(file.path) ?? []);
  if (known.length === 0) {
    throw new Error("no test file matches a path in the browser test times");
  }
  return known.reduce((sum, ms) => sum + ms, 0) / known.length;
}

export function assignShards<T extends ShardFile>(
  files: readonly T[],
  times: ReadonlyMap<string, number>,
  count: number,
): T[][] {
  const estimate = estimateFor(files, times);
  const timed = files.map((file) => ({ file, ms: times.get(file.path) ?? estimate }));
  timed.sort((a, b) => b.ms - a.ms || (a.file.id < b.file.id ? -1 : a.file.id > b.file.id ? 1 : 0));

  const shards: { files: T[]; total: number }[] = Array.from({ length: count }, () => ({
    files: [],
    total: 0,
  }));
  for (const { file, ms } of timed) {
    const lightest = shards.reduce((best, shard) => (shard.total < best.total ? shard : best));
    lightest.files.push(file);
    lightest.total += ms;
  }
  return shards.map((shard) => shard.files);
}

export function parseLogTimes(log: string): Map<string, number> {
  const times = new Map<string, number>();
  const plain = stripVTControlCharacters(log).replace(CARET_COLOR_CODE, "");
  for (const line of plain.split("\n")) {
    const match = PASSED_BROWSER_FILE.exec(line);
    if (!match) continue;
    const [, project, file, ms] = match;
    if (project === undefined || file === undefined || ms === undefined) continue;
    times.set(`${project}/${file}`, Math.max(Number(ms), 1));
  }
  return times;
}

export function refreshTimes(
  previous: ReadonlyMap<string, number>,
  measured: ReadonlyMap<string, number>,
  fileExists: (path: string) => boolean,
): Map<string, number> {
  const merged = [...new Map([...previous, ...measured])]
    .filter(([path]) => fileExists(path))
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return new Map(merged);
}

export function medianTimes(runs: readonly ReadonlyMap<string, number>[]): Map<string, number> {
  const samples = new Map<string, number[]>();
  for (const run of runs) {
    for (const [path, ms] of run) samples.set(path, [...(samples.get(path) ?? []), ms]);
  }
  const medians = [...samples.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, values]): [string, number] => {
      const sorted = values.toSorted((a, b) => a - b);
      const upper = sorted[Math.floor(sorted.length / 2)] ?? 1;
      const lower = sorted[Math.ceil(sorted.length / 2) - 1] ?? upper;
      return [path, Math.round((lower + upper) / 2)];
    });
  return new Map(medians);
}

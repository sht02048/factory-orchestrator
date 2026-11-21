import { describe, expect, it } from "vitest";

import {
  assignShards,
  medianTimes,
  parseFileTimes,
  parseLogTimes,
  refreshTimes,
} from "./time-shards.ts";

const file = (path: string) => ({ id: `e2e:${path}`, path });
const paths = (shards: { path: string }[][]) => shards.map((s) => s.map((f) => f.path));

describe("assignShards", () => {
  const times = new Map([
    ["a", 100],
    ["b", 80],
    ["c", 60],
    ["d", 40],
    ["e", 20],
  ]);

  it("puts every file in exactly one shard", () => {
    const files = [...times.keys()].map(file);
    const assigned = paths(assignShards(files, times, 4)).flat();
    expect(assigned.toSorted()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("gives the longest remaining file to the lightest shard", () => {
    const shards = assignShards([...times.keys()].map(file), times, 2);
    expect(paths(shards)).toEqual([
      ["a", "d", "e"],
      ["b", "c"],
    ]);
  });

  it("splits the same way whatever order the files arrive in", () => {
    const forward = [...times.keys()].map(file);
    expect(assignShards(forward.toReversed(), times, 3)).toEqual(assignShards(forward, times, 3));
  });

  it("breaks equal times by id so every shard job agrees", () => {
    const equal = new Map([
      ["x", 10],
      ["y", 10],
    ]);
    expect(paths(assignShards([file("y"), file("x")], equal, 2))).toEqual([["x"], ["y"]]);
  });

  it("counts a file without a time as the average of the known files", () => {
    const known = new Map([
      ["long", 90],
      ["short", 10],
    ]);
    const shards = assignShards([file("long"), file("short"), file("new")], known, 2);
    expect(paths(shards)).toEqual([["long"], ["new", "short"]]);
  });

  it("fails when no file matches a time, so a path mismatch cannot pass unnoticed", () => {
    const stale = new Map([["elsewhere", 10]]);
    expect(() => assignShards([file("a"), file("b")], stale, 2)).toThrow(/no test file matches/);
  });
});

describe("refreshTimes", () => {
  it("keeps the old time of a file the log missed and drops deleted files", () => {
    const previous = new Map([
      ["kept", 50],
      ["updated", 10],
      ["deleted", 30],
    ]);
    const measured = new Map([
      ["updated", 20],
      ["added", 5],
    ]);
    const refreshed = refreshTimes(previous, measured, (path) => path !== "deleted");
    expect([...refreshed]).toEqual([
      ["added", 5],
      ["kept", 50],
      ["updated", 20],
    ]);
  });
});

describe("parseFileTimes", () => {
  it("reads file paths and milliseconds", () => {
    expect(parseFileTimes({ "e2e/src/a.test.ts": 12 })).toEqual(
      new Map([["e2e/src/a.test.ts", 12]]),
    );
  });

  it.each([[null], [[1]], [{ a: "1" }], [{ a: 0 }], [{ a: -1 }], [{ a: 1.5 }]])(
    "rejects %j",
    (value) => {
      expect(() => parseFileTimes(value)).toThrow(/browser test time/);
    },
  );
});

describe("parseLogTimes", () => {
  it("reads passed browser files from a CI log with color codes", () => {
    const log = [
      "browser (3)\tBrowser tests\t2026-11-21T07:59:13Z  ^[[32m✓^[[39m  e2e  src/home.test.ts (19 tests) 100779ms",
      "browser (3)\tBrowser tests\t2026-11-21T07:57:31Z  \u001b[32m✓\u001b[39m  demo  src/seed.test.ts (3 tests | 1 skipped) 17ms",
    ].join("\n");
    expect(parseLogTimes(log)).toEqual(
      new Map([
        ["e2e/src/home.test.ts", 100779],
        ["demo/src/seed.test.ts", 17],
      ]),
    );
  });

  it("ignores other projects and failed files", () => {
    const log = [
      " ✓  core  src/a.test.ts (1 test) 5ms",
      " ❯  e2e  src/b.test.ts (2 tests | 1 failed) 900ms",
    ].join("\n");
    expect(parseLogTimes(log).size).toBe(0);
  });
});

describe("medianTimes", () => {
  it("takes the middle value, averaging an even count, and keeps files from any run", () => {
    const runs = [
      new Map([
        ["a", 10],
        ["b", 10],
      ]),
      new Map([
        ["a", 30],
        ["b", 20],
      ]),
      new Map([
        ["a", 20],
        ["c", 7],
      ]),
    ];
    expect(medianTimes(runs)).toEqual(
      new Map([
        ["a", 20],
        ["b", 15],
        ["c", 7],
      ]),
    );
  });
});

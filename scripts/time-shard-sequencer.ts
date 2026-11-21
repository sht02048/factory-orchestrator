import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

import { assignShards, BROWSER_TEST_TIMES_FILE, parseFileTimes } from "./time-shards.ts";

function readBrowserTestTimes(): Map<string, number> {
  const parsed: unknown = JSON.parse(readFileSync(BROWSER_TEST_TIMES_FILE, "utf8"));
  return parseFileTimes(parsed);
}

export class TimeShardSequencer extends BaseSequencer {
  override shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { root, shard } = this.ctx.config;
    if (!shard) return Promise.resolve(files);

    const entries = files.map((spec) => {
      const path = relative(root, spec.moduleId).split(sep).join("/");
      return { id: `${spec.project.name}:${path}`, path, spec };
    });
    const shards = assignShards(entries, readBrowserTestTimes(), shard.count);
    const selected = shards[shard.index - 1] ?? [];
    return Promise.resolve(selected.map((entry) => entry.spec));
  }
}

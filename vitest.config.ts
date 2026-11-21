import { defineConfig } from "vitest/config";

import { TimeShardSequencer } from "./scripts/time-shard-sequencer.ts";

export default defineConfig({
  test: {
    sequence: { sequencer: TimeShardSequencer },
    projects: [
      "packages/*",
      "apps/*",
      "e2e",
      "demo",
      { test: { name: "scripts", include: ["scripts/**/*.test.ts"] } },
    ],
  },
});

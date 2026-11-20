import { defineProject } from "vitest/config";

export default defineProject({
  root: import.meta.dirname,
  test: {
    name: "measure",
    include: ["src/**/*.measure.ts"],
    testTimeout: 1_800_000,
    hookTimeout: 240_000,
  },
});

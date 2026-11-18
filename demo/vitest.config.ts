import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "demo",
    include: ["src/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});

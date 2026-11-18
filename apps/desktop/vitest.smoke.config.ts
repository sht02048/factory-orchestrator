import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "desktop-smoke",
    include: ["smoke/**/*.smoke.ts"],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});

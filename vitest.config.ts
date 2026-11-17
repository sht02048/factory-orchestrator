import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/*",
      "e2e",
      { test: { name: "scripts", include: ["scripts/**/*.test.ts"] } },
    ],
  },
});

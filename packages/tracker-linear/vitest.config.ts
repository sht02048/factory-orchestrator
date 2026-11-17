import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "tracker-linear",
    include: ["src/**/*.test.ts"],
  },
});

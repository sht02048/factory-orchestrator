import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "runner-orca",
    include: ["src/**/*.test.ts"],
  },
});

import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "codehost-github",
    include: ["src/**/*.test.ts"],
  },
});

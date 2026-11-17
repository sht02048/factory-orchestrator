import { fileURLToPath } from "node:url";
import stylex from "@stylexjs/unplugin";
import type { PluginOption } from "vite";
import { defineProject } from "vitest/config";

// @stylexjs/unplugin 의 vite() 는 반환 타입이 any 라 type-aware 린트가 막는다.
const stylexPlugin = stylex.vite as (options?: Parameters<typeof stylex.vite>[0]) => PluginOption;

export default defineProject({
  plugins: [
    stylexPlugin({
      dev: false,
      runtimeInjection: false,
      unstable_moduleResolution: {
        type: "commonJS",
        rootDir: fileURLToPath(new URL("../..", import.meta.url)),
      },
    }),
  ],
  test: {
    name: "web",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

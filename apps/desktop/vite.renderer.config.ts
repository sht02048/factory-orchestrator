import { fileURLToPath } from "node:url";
import stylex from "@stylexjs/unplugin";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";

const stylexPlugin = stylex.vite as (options?: Parameters<typeof stylex.vite>[0]) => PluginOption;

export default defineConfig({
  root: "src/renderer",
  base: "./",
  build: { outDir: "../../dist/renderer", emptyOutDir: true, target: "chrome140" },
  plugins: [
    stylexPlugin({
      useCSSLayers: true,
      dev: false,
      runtimeInjection: false,
      unstable_moduleResolution: {
        type: "commonJS",
        rootDir: fileURLToPath(new URL("../..", import.meta.url)),
      },
    }),
    viteReact(),
  ],
});

import { fileURLToPath } from "node:url";
import { bundleMigrations } from "@factory/db/bundle-migrations";
import stylex from "@stylexjs/unplugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";

const stylexPlugin = stylex.vite as (options?: Parameters<typeof stylex.vite>[0]) => PluginOption;

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ command }) => ({
  server: { host: "127.0.0.1", port: 3000 },
  ...(command === "build" ? { ssr: { noExternal: true } } : {}),
  plugins: [
    stylexPlugin({
      useCSSLayers: true,
      dev: process.env["NODE_ENV"] !== "production",
      runtimeInjection: false,
      unstable_moduleResolution: { type: "commonJS", rootDir: repoRoot },
    }),
    tanstackStart(),
    viteReact(),
    bundleMigrations(),
  ],
}));

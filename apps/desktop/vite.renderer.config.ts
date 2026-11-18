import { fileURLToPath } from "node:url";
import stylex from "@stylexjs/unplugin";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";

// @stylexjs/unplugin 의 vite() 는 반환 타입이 any 라 type-aware 린트가 막는다(apps/web 과 같다).
const stylexPlugin = stylex.vite as (options?: Parameters<typeof stylex.vite>[0]) => PluginOption;

// 앱이 직접 그리는 화면. file:// 로 열므로 자산 경로를 상대로 둔다.
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

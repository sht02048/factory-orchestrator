import { fileURLToPath } from "node:url";
import stylex from "@stylexjs/unplugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";

// @stylexjs/unplugin 의 vite() 는 반환 타입이 any 라 type-aware 린트가 막는다.
const stylexPlugin = stylex.vite as (options?: Parameters<typeof stylex.vite>[0]) => PluginOption;

// 토큰 변수 이름(해시)은 파일 경로로 정해진다. packages/ui 의 테스트와 같은 값이 나오도록 저장소 루트를 기준으로 둔다.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  server: { host: "127.0.0.1", port: 3000 },
  plugins: [
    stylexPlugin({
      useCSSLayers: true,
      dev: process.env["NODE_ENV"] !== "production",
      runtimeInjection: false,
      unstable_moduleResolution: { type: "commonJS", rootDir: repoRoot },
    }),
    tanstackStart(),
    viteReact(),
  ],
});

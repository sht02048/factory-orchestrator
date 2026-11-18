import { fileURLToPath } from "node:url";
import { bundleMigrations } from "@factory/db/bundle-migrations";
import stylex from "@stylexjs/unplugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";

// @stylexjs/unplugin 의 vite() 는 반환 타입이 any 라 type-aware 린트가 막는다.
const stylexPlugin = stylex.vite as (options?: Parameters<typeof stylex.vite>[0]) => PluginOption;

// 토큰 변수 이름(해시)은 파일 경로로 정해진다. packages/ui 의 테스트와 같은 값이 나오도록 저장소 루트를 기준으로 둔다.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ command }) => ({
  server: { host: "127.0.0.1", port: 3000 },
  // 프로덕션 server 번들에 의존성까지 모두 묶어 node_modules 없이 dist만으로 돌게 한다(서버 배포물, 0029).
  // Node 내장 모듈(node:sqlite 등)은 묶지 않는다. 개발 서버는 CommonJS 패키지(react 등)를 그대로 읽지
  // 못하므로 빌드에만 쓴다.
  ...(command === "build" ? { ssr: { noExternal: true } } : {}),
  plugins: [
    stylexPlugin({
      useCSSLayers: true,
      dev: process.env["NODE_ENV"] !== "production",
      runtimeInjection: false,
      unstable_moduleResolution: { type: "commonJS", rootDir: repoRoot },
    }),
    // 서버 진입은 src/server.ts 다. 모든 요청을 라우터 앞에서 거른다(Host·Origin 검사, 티켓 0048).
    tanstackStart(),
    viteReact(),
    // 프로덕션 server 번들이 DB 마이그레이션 SQL을 찾도록 산출물에 함께 싣는다.
    bundleMigrations(),
  ],
}));

import { defineConfig } from "vite";

// Electron main 을 파일 하나로 묶는다. 워크스페이스 패키지(@factory/cli 등)는 소스(.ts)라 묶어야 돌고,
// 패키징한 앱에는 node_modules 를 싣지 않는다. electron 과 Node 내장 모듈만 밖에 둔다.
export default defineConfig({
  build: {
    ssr: "src/main/main.ts",
    outDir: "dist/main",
    target: "node24",
    emptyOutDir: true,
    rollupOptions: { external: ["electron"], output: { entryFileNames: "main.js", format: "es" } },
  },
  ssr: { noExternal: true, external: ["electron"] },
});

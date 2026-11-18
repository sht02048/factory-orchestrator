import { defineConfig } from "vite";

// 프로덕션 web을 띄우는 srvx CLI를 Node가 바로 돌릴 수 있는 파일로 묶는다(src/srvx-cli.ts). web 빌드
// (vite.config.ts) 뒤에 돌아 같은 dist에 더한다. 그래서 dist를 비우지 않는다.
export default defineConfig({
  build: {
    ssr: "src/srvx-cli.ts",
    outDir: "dist/srvx",
    target: "node24",
    emptyOutDir: false,
    rollupOptions: { output: { entryFileNames: "srvx.js" } },
  },
  // 의존성까지 모두 묶어 dist만으로 돈다. Node 내장 모듈은 묶지 않는다.
  ssr: { noExternal: true },
});

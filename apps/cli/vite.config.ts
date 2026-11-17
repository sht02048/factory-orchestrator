import { bundleMigrations } from "@factory/db/bundle-migrations";
import { defineConfig } from "vite";

// CLI를 Node가 바로 돌릴 수 있는 파일 하나로 묶는다. 워크스페이스 패키지는 소스(.ts)를 내보내고
// `.js` 확장자로 서로 import해 Node가 그대로 읽지 못한다(apps/worker와 같다).
export default defineConfig({
  build: {
    ssr: "src/cli.ts",
    outDir: "dist",
    target: "node24",
    emptyOutDir: true,
    // migrate.ts가 든 청크 기준 `../drizzle`에 마이그레이션을 싣는다. 청크를 하위 폴더에 둬야 산출물 안에 든다.
    rollupOptions: { output: { entryFileNames: "bin/[name].js", banner: "#!/usr/bin/env node" } },
  },
  // 의존성까지 모두 묶어 dist만으로 돈다. Node 내장 모듈(node:sqlite 등)은 묶지 않는다.
  ssr: { noExternal: true },
  plugins: [bundleMigrations()],
});

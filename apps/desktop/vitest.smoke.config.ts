import { defineConfig } from "vitest/config";

// 실제 서버 배포물·Electron·패키징한 앱으로 도는 로컬 시험(티켓 0046). CI 에서는 돌지 않는다(smoke/*.smoke.ts 머리말).
export default defineConfig({
  test: {
    name: "desktop-smoke",
    include: ["smoke/**/*.smoke.ts"],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});

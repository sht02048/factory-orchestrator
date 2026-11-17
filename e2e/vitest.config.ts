import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "e2e",
    include: ["src/**/*.test.ts"],
    // web 개발 서버를 띄우고 첫 요청에서 화면 모듈을 변환해 단위 시험보다 오래 걸린다.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});

import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "demo",
    include: ["src/**/*.test.ts"],
    // 개발 진입점 시험은 web 개발 서버를 띄우고 첫 요청에서 화면 모듈을 변환해 오래 걸린다.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});

import { defineProject } from "vitest/config";

// Electron 없이 도는 모듈(src/core)과 화면 상태만 시험한다. 실제 서버 배포물·패키징한 앱은 `pnpm smoke`(로컬)가 본다.
export default defineProject({
  test: {
    name: "desktop",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

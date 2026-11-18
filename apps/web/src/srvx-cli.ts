import { main } from "srvx/cli";

/*
 * 프로덕션 web을 띄우는 srvx CLI(`srvx` 실행 파일과 같다). `vite.srvx.config.ts`가 의존성까지 묶어
 * `dist/srvx/srvx.js`로 내보내, 서버 번들과 함께 node_modules 없이 `dist`만으로 web이 뜬다(0029).
 */
await main({
  usage: {
    command: "srvx",
    docs: "https://srvx.h3.dev",
    issues: "https://github.com/h3js/srvx/issues",
  },
});

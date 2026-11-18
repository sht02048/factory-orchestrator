/*
 * 개발 진입점의 가짜 어댑터와 가짜 값이 배포물에 들어가지 않았는지 보는 검사(티켓 0047).
 * 빌드한 web·worker·CLI 산출물(apps/<앱>/dist)에서 개발 경로에만 있는 표시 문자열을 찾는다.
 * 가짜 어댑터는 core 의 시험용 모듈(@factory/core/testing)과 demo/ 에만 있고, 제품의 어댑터 등록표는 그것을
 * import 하지 않는다. 이 검사는 그 경계가 빌드 결과에서도 지켜지는지 확인한다.
 *
 * 실행: pnpm build 뒤에 node scripts/check-dev-code.ts
 * CI 는 test 뒤에 build 하므로 빌드 뒤 단계에서 돈다. import 경계 자체는 demo/src/boundary.test.ts 가 본다.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** 개발 경로에만 있는 문자열. core 가짜 어댑터의 오류 문구, 가짜 값, 개발 도구 문구다 */
export const DEV_MARKERS = [
  "fake runner is offline",
  "fake-mailbox-",
  "lin_api_demo",
  "github_pat_demo",
  "__factoryDev",
  "factory-dev-adapters",
  "가짜 값 채우기",
] as const;

const TEXT_EXTENSIONS = /\.(m?js|cjs|json|html|css|map)$/;

export function findDevMarkers(text: string): string[] {
  return DEV_MARKERS.filter((marker) => text.includes(marker));
}

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (TEXT_EXTENSIONS.test(entry.name)) yield path;
  }
}

if (import.meta.main) {
  const root = join(import.meta.dirname, "..");
  const dists = ["web", "worker", "cli"].map((app) => join(root, "apps", app, "dist"));
  const missing = dists.filter((dist) => !existsSync(dist));
  if (missing.length > 0) {
    console.error(`build output not found (run pnpm build): ${missing.join(", ")}`);
    process.exit(1);
  }
  let checked = 0;
  const found: string[] = [];
  for (const dist of dists) {
    for (const file of files(dist)) {
      checked += 1;
      for (const marker of findDevMarkers(readFileSync(file, "utf8"))) {
        found.push(`${relative(root, file)}: ${marker}`);
      }
    }
  }
  if (found.length > 0) {
    console.error(`dev-only code found in build output:\n${found.join("\n")}`);
    process.exit(1);
  }
  console.log(`no dev-only code in ${checked} build file(s)`);
}

/*
 * 서버 배포물(scripts/bundle.ts)이 저장소 없이 돌고 시험용·개발용 코드를 싣지 않았는지 보는 정적 검사.
 * 배포물을 만들 때와 실행 시험(scripts/smoke-cli.ts --bundle)이 함께 쓴다.
 */

import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";

/** 테스트용 가짜 어댑터(@factory/core/testing)의 이름. 번들은 이름을 줄이지 않아 묶였으면 남는다 */
const FAKE_ADAPTER =
  /\b(?:Fake(?:Runner|Tracker|CodeHost)|fake(?:Runner|Tracker|CodeHost)Factory)\b/g;

/** 파일 맨 앞 줄의 정적 import·export, 동적 import, require가 부르는 모듈 이름 */
/**
 * 개발 진입점 `pnpm dev`(demo/, 티켓 0047)에만 있는 문자열. 가짜 값, 개발 도구 문구, 개발용 vite 플러그인 이름이다.
 * 배포물에 있으면 개발 경로의 가짜 어댑터나 개발 도구가 함께 묶인 것이다.
 */
export const DEV_ONLY_MARKERS = [
  "lin_api_demo",
  "github_pat_demo",
  "__factoryDev",
  "__factoryDemoWorld",
  "factory-dev-adapters",
  "factory-dev-tools",
  "가짜 값 채우기",
] as const;

const MODULE_REFERENCES = [
  /^(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm,
  /^import\s*["']([^"']+)["']/gm,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  /\b(?:__)?require\(\s*["']([^"']+)["']\s*\)/g,
];

const BUILTINS = new Set(builtinModules);

/** 상대 경로도 Node 내장 모듈도 아니라 `node_modules`에서 찾아야 하는 모듈 이름 */
export function packageImports(source: string): string[] {
  const found = new Set<string>();
  for (const pattern of MODULE_REFERENCES) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (name === undefined || name.startsWith(".") || name.startsWith("/")) continue;
      if (name.startsWith("node:") || BUILTINS.has(name)) continue;
      found.add(name);
    }
  }
  return [...found].toSorted();
}

/** 소스에 든 가짜 어댑터 이름 */
export function fakeAdapterNames(source: string): string[] {
  return [...new Set(source.match(FAKE_ADAPTER) ?? [])].toSorted();
}

/** 소스에 든 개발 진입점 전용 문자열 */
export function devOnlyMarkers(source: string): string[] {
  return DEV_ONLY_MARKERS.filter((marker) => source.includes(marker));
}

/** 배포물 폴더의 문제. 비어 있으면 통과다 */
export function findBundleProblems(root: string): string[] {
  const problems: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const shown = relative(root, path);
      if (entry.name === "node_modules") {
        problems.push(`${shown}: node_modules must not be in the bundle`);
        continue;
      }
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name)) {
        problems.push(`${shown}: TypeScript source must not be in the bundle`);
      }
      if (!/\.(?:js|mjs|cjs)$/.test(entry.name)) continue;
      const source = readFileSync(path, "utf8");
      const imports = packageImports(source);
      if (imports.length > 0) problems.push(`${shown}: imports packages ${imports.join(", ")}`);
      const fakes = fakeAdapterNames(source);
      if (fakes.length > 0)
        problems.push(`${shown}: contains test fake adapters ${fakes.join(", ")}`);
      const dev = devOnlyMarkers(source);
      if (dev.length > 0) problems.push(`${shown}: contains dev-only code ${dev.join(", ")}`);
    }
  };
  walk(root);
  return problems;
}

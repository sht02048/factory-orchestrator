/*
 * 서버 배포물을 만든다(0029). 저장소 클론·pnpm 빌드 없이 Node 24만으로 도는 web·worker·CLI 한 덩어리다.
 * 각 앱의 빌드 산출물(`dist`)은 의존성까지 묶여 있어 `node_modules`가 필요 없다. 이 스크립트는 그것을
 * 한 폴더에 모으고 tarball로 싼다. 데스크톱 앱(0046)과 헤드리스 서비스가 같은 배포물을 쓴다.
 *
 * 실행: pnpm build 뒤에 node scripts/bundle.ts [--out-dir <dir>]
 * 결과: <out-dir>/factory-orchestrator-<version>/ 와 <out-dir>/factory-orchestrator-<version>.tar.gz
 *       (기본 out-dir은 저장소 루트의 dist/). 공개(npm publish, 릴리스)는 하지 않는다(0031).
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { findBundleProblems } from "./bundle-check.ts";

const REPO = resolve(import.meta.dirname, "..");
const NAME = "factory-orchestrator";

const { values } = parseArgs({ options: { "out-dir": { type: "string" } } });
const outDir = resolve(values["out-dir"] ?? join(REPO, "dist"));

function readJson(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return Object.fromEntries(Object.entries(parsed));
}

const root = readJson(join(REPO, "package.json"));
const version = typeof root["version"] === "string" ? root["version"] : "0.0.0";

// 배포물 안의 폴더 이름은 CLI가 web·worker를 찾는 이름(apps/cli/src/layout.ts BUNDLE_DIRS)과 같다.
// 다르면 실행 시험(smoke-cli --bundle)의 start가 실패한다.
const parts = [
  { dir: "cli", from: join(REPO, "apps", "cli", "dist"), entry: join("bin", "cli.js") },
  { dir: "web", from: join(REPO, "apps", "web", "dist"), entry: join("srvx", "srvx.js") },
  { dir: "worker", from: join(REPO, "apps", "worker", "dist"), entry: join("server", "main.js") },
];
const missing = parts
  .map((part) => join(part.from, part.entry))
  .filter((path) => !existsSync(path));
if (missing.length > 0) {
  console.error(`build output not found (run pnpm build first): ${missing.join(", ")}`);
  process.exit(1);
}

const bundleName = `${NAME}-${version}`;
const bundleDir = join(outDir, bundleName);
const tarball = join(outDir, `${bundleName}.tar.gz`);
rmSync(bundleDir, { recursive: true, force: true });
rmSync(tarball, { force: true });
mkdirSync(bundleDir, { recursive: true });

for (const part of parts) cpSync(part.from, join(bundleDir, part.dir), { recursive: true });
cpSync(join(REPO, "LICENSE"), join(bundleDir, "LICENSE"));
// 의존성이 없는 package.json. 묶은 파일이 ES 모듈로 읽히게 하고, Node 버전 요구와 실행 파일을 적는다.
writeFileSync(
  join(bundleDir, "package.json"),
  `${JSON.stringify(
    {
      name: NAME,
      version,
      private: true,
      license: root["license"],
      type: "module",
      bin: { [NAME]: "cli/bin/cli.js" },
      engines: root["engines"],
    },
    null,
    2,
  )}\n`,
);

const problems = findBundleProblems(bundleDir);
if (problems.length > 0) {
  console.error(`server bundle check failed:\n${problems.map((line) => `- ${line}`).join("\n")}`);
  process.exit(1);
}

// macOS tar가 확장 속성을 `._*` 파일로 함께 싸지 않게 한다.
const tar = spawnSync("tar", ["-czf", tarball, "-C", outDir, bundleName], {
  stdio: "inherit",
  env: { ...process.env, COPYFILE_DISABLE: "1" },
});
if (tar.status !== 0) {
  console.error(`tar exited with ${tar.status ?? tar.signal ?? "unknown"}`);
  process.exit(1);
}
console.log(`server bundle: ${bundleDir}`);
console.log(`tarball: ${tarball}`);

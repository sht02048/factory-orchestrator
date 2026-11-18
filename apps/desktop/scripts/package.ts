/*
 * 데스크톱 앱을 이 기계에서 서명 없이 패키징한다(티켓 0046). 산출물은 어디에도 올리지 않는다. 서명·공증·자동 업데이트
 * 피드·Releases 업로드는 릴리스 때(티켓 0046 「후속(릴리스 때)」, 0031) 한다.
 *
 * 먼저: 저장소 루트에서 pnpm build && pnpm run bundle (서버 배포물, 0029)
 * 실행: pnpm --filter @factory/desktop run package [--arch arm64|x64] [--bundle <서버 배포물 폴더>] [--out <폴더>]
 * 결과(기본): apps/desktop/dist/app/Factory Orchestrator-darwin-<arch>/Factory Orchestrator.app 과 같은 폴더의 .zip
 *
 * 앱은 node_modules 없이 dist/(main·preload·renderer)와 assets/ 만 싣고, 서버 배포물을 고치지 않고
 * Contents/Resources/server/ 에 싣는다. 도구는 @electron/packager 다(이유는 티켓 0046 「패키징 도구」).
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { packager } from "@electron/packager";

const DESKTOP = resolve(import.meta.dirname, "..");
const REPO = resolve(DESKTOP, "..", "..");
const PRODUCT = "Factory Orchestrator";

const { values } = parseArgs({
  options: { arch: { type: "string" }, bundle: { type: "string" }, out: { type: "string" } },
});

function readJson(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return Object.fromEntries(Object.entries(parsed));
}

function stringField(json: Record<string, unknown>, key: string): string {
  const value = json[key];
  if (typeof value !== "string") throw new Error(`${key} missing`);
  return value;
}

const version = stringField(readJson(join(REPO, "package.json")), "version");
const electronVersion = stringField(
  readJson(join(DESKTOP, "node_modules", "electron", "package.json")),
  "version",
);
const bundleDir = resolve(values.bundle ?? join(REPO, "dist", `factory-orchestrator-${version}`));
for (const required of [
  join(DESKTOP, "dist", "main", "main.js"),
  join(DESKTOP, "dist", "preload", "preload.cjs"),
  join(DESKTOP, "dist", "renderer", "index.html"),
  join(bundleDir, "cli", "bin", "cli.js"),
]) {
  if (!existsSync(required)) {
    console.error(
      `${required} not found. Run pnpm build && pnpm run bundle at the repository root first.`,
    );
    process.exit(1);
  }
}

const work = join(DESKTOP, "dist", "package");
const stage = join(work, "app");
const resources = join(work, "resources");
const out = resolve(values.out ?? join(DESKTOP, "dist", "app"));
rmSync(work, { recursive: true, force: true });
rmSync(out, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
mkdirSync(resources, { recursive: true });

for (const dir of ["main", "preload", "renderer"]) {
  cpSync(join(DESKTOP, "dist", dir), join(stage, "dist", dir), { recursive: true });
}
cpSync(join(DESKTOP, "assets"), join(stage, "assets"), { recursive: true });
writeFileSync(
  join(stage, "package.json"),
  `${JSON.stringify(
    {
      name: "factory-orchestrator-desktop",
      productName: PRODUCT,
      version,
      type: "module",
      main: "dist/main/main.js",
      license: "MIT",
    },
    null,
    2,
  )}\n`,
);
// 서버 배포물을 이름만 바꿔 그대로 싣는다.
cpSync(bundleDir, join(resources, "server"), { recursive: true });

const arch = values.arch ?? process.arch;
const [appDir] = await packager({
  dir: stage,
  out,
  name: PRODUCT,
  platform: "darwin",
  arch,
  electronVersion,
  appVersion: version,
  appBundleId: "dev.factory-orchestrator.desktop",
  appCategoryType: "public.app-category.developer-tools",
  asar: true,
  extraResource: [join(resources, "server")],
  overwrite: true,
  prune: false,
  // 서명은 하지 않는다(로컬 개발용). 릴리스 때 Developer ID 로 서명·공증한다.
  osxSign: undefined,
});
if (appDir === undefined) throw new Error("packager produced nothing");

const appPath = join(appDir, `${PRODUCT}.app`);
const zip = join(out, `${PRODUCT}-${version}-darwin-${arch}.zip`);
const ditto = spawnSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zip], {
  stdio: "inherit",
});
if (ditto.status !== 0) throw new Error(`ditto exited with ${ditto.status ?? "unknown"}`);
rmSync(work, { recursive: true, force: true });

console.log(`app: ${appPath}`);
console.log(`zip: ${zip}`);
console.log(
  `server bundle: ${readdirSync(join(appPath, "Contents", "Resources", "server")).join(", ")}`,
);

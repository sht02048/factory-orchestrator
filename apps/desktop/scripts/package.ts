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
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { packager } from "@electron/packager";
import { appIconPaths } from "../src/core/app-icon.ts";

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
cpSync(bundleDir, join(resources, "server"), { recursive: true });

const actool = spawnSync("actool", ["--version"], { encoding: "utf8" });
const icon = appIconPaths(join(DESKTOP, "icons"), actool.status === 0 ? actool.stdout : null);
console.log(`app icon: ${icon.map((path) => basename(path)).join(", ")}`);

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
  icon,
  asar: true,
  extraResource: [join(resources, "server")],
  overwrite: true,
  prune: false,
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

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { findBundleProblems, NOTICE_FILE } from "./bundle-check.ts";
import { copyleftKind, readManifests, renderNotices, THIRD_PARTY_DIR } from "./third-party.ts";

const REPO = resolve(import.meta.dirname, "..");
const NAME = "ganger";

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

for (const part of parts) {
  cpSync(part.from, join(bundleDir, part.dir), {
    recursive: true,
    filter: (source) => source !== join(part.from, THIRD_PARTY_DIR),
  });
}
cpSync(join(REPO, "LICENSE"), join(bundleDir, "LICENSE"));
const thirdParty = readManifests(parts.map((part) => join(part.from, THIRD_PARTY_DIR)));
writeFileSync(join(bundleDir, NOTICE_FILE), renderNotices("Ganger", thirdParty));
for (const pkg of thirdParty.filter((item) => copyleftKind(item.license) !== null)) {
  console.warn(`copyleft license (${pkg.license}): ${pkg.name}@${pkg.version}`);
}
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

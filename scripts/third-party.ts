import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export const REPO_ROOT = resolve(import.meta.dirname, "..");
export const THIRD_PARTY_DIR = "third-party";

export interface ThirdPartyPackage {
  name: string;
  version: string;
  license: string;
  dir: string;
}

interface BundleItem {
  type: string;
  moduleIds?: readonly string[];
}

interface WriteBundleContext {
  environment?: { name: string };
}

const NODE_MODULES = `${sep}node_modules${sep}`;
const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i;
const STRONG_COPYLEFT = /\b(?:A?GPL|LGPL|SSPL|EUPL|OSL|CC-BY-SA)\b/i;
const WEAK_COPYLEFT = /\b(?:MPL|EPL|CDDL|CPL)\b/i;

function readJsonObject(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return Object.fromEntries(Object.entries(parsed));
}

export function packageDirOf(moduleId: string): string | null {
  const path = moduleId.replace(/^\0+/, "").split("?")[0] ?? "";
  const at = path.lastIndexOf(NODE_MODULES);
  if (at < 0) return null;
  const rest = path.slice(at + NODE_MODULES.length).split(sep);
  const [first, second] = rest;
  if (first === undefined || first === "") return null;
  const name = first.startsWith("@") && second !== undefined ? `${first}${sep}${second}` : first;
  return path.slice(0, at + NODE_MODULES.length) + name;
}

function licenseOf(json: Record<string, unknown>): string {
  const license = json["license"];
  if (typeof license === "string") return license;
  if (typeof license === "object" && license !== null && "type" in license) {
    const type: unknown = license.type;
    if (typeof type === "string") return type;
  }
  return "UNKNOWN";
}

export function readThirdPartyPackage(dir: string, root = REPO_ROOT): ThirdPartyPackage {
  const json = readJsonObject(join(dir, "package.json"));
  const name = json["name"];
  const version = json["version"];
  if (typeof name !== "string" || typeof version !== "string") {
    throw new Error(`${join(dir, "package.json")} has no name or version`);
  }
  return { name, version, license: licenseOf(json), dir: relative(root, dir) };
}

export function bundledPackages(
  moduleIds: Iterable<string>,
  root = REPO_ROOT,
): ThirdPartyPackage[] {
  const dirs = new Set<string>();
  for (const id of moduleIds) {
    const dir = packageDirOf(id);
    if (dir !== null && existsSync(join(dir, "package.json"))) dirs.add(dir);
  }
  return uniquePackages([...dirs].map((dir) => readThirdPartyPackage(dir, root)));
}

export function uniquePackages(packages: Iterable<ThirdPartyPackage>): ThirdPartyPackage[] {
  const byKey = new Map<string, ThirdPartyPackage>();
  for (const pkg of packages) byKey.set(`${pkg.name}@${pkg.version}`, pkg);
  return [...byKey.values()].toSorted(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

export function thirdPartyManifest(outDir: string, label: string) {
  return {
    name: "ganger-third-party-manifest",
    writeBundle(this: WriteBundleContext, _options: unknown, bundle: Record<string, BundleItem>) {
      const ids = Object.values(bundle).flatMap((item) => item.moduleIds ?? []);
      const environment = this.environment?.name ?? "build";
      mkdirSync(outDir, { recursive: true });
      writeFileSync(
        join(outDir, `${label}-${environment}.json`),
        `${JSON.stringify(bundledPackages(ids), null, 2)}\n`,
      );
    },
  };
}

function parseManifest(path: string): ThirdPartyPackage[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${path} is not a package list`);
  return parsed.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) throw new Error(`${path}: bad entry`);
    const { name, version, license, dir } = Object.fromEntries(Object.entries(entry));
    if (
      typeof name !== "string" ||
      typeof version !== "string" ||
      typeof license !== "string" ||
      typeof dir !== "string"
    ) {
      throw new Error(`${path}: bad entry`);
    }
    return { name, version, license, dir };
  });
}

export function readManifests(dirs: readonly string[]): ThirdPartyPackage[] {
  const packages: ThirdPartyPackage[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) throw new Error(`${dir} not found. Run pnpm build first.`);
    for (const file of readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .toSorted()) {
      packages.push(...parseManifest(join(dir, file)));
    }
  }
  return uniquePackages(packages);
}

export function licenseTexts(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => LICENSE_FILE.test(name))
    .toSorted()
    .map((name) => readFileSync(join(dir, name), "utf8").trim());
}

export function copyleftKind(license: string): "strong" | "weak" | null {
  if (STRONG_COPYLEFT.test(license)) return "strong";
  if (WEAK_COPYLEFT.test(license)) return "weak";
  return null;
}

export function sourceOf(dir: string): string | null {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return null;
  const json = readJsonObject(path);
  const repository = json["repository"];
  const url =
    typeof repository === "string"
      ? repository
      : typeof repository === "object" && repository !== null && "url" in repository
        ? repository.url
        : json["homepage"];
  if (typeof url !== "string") return null;
  return url.replace(/^git\+/, "").replace(/\.git$/, "");
}

export function renderNotices(
  product: string,
  packages: readonly ThirdPartyPackage[],
  root = REPO_ROOT,
): string {
  const rule = "-".repeat(80);
  const sections = packages.map((pkg) => {
    const dir = join(root, pkg.dir);
    const texts = licenseTexts(dir);
    const source = sourceOf(dir);
    const header = [`${pkg.name} ${pkg.version}`, `License: ${pkg.license}`];
    if (source !== null) header.push(`Source: ${source}`);
    const body =
      texts.length > 0
        ? texts.join("\n\n")
        : `This package ships no license file. It is licensed under ${pkg.license}.`;
    return `${rule}\n${header.join("\n")}\n\n${body}\n`;
  });
  return `${product} includes the following third-party software.\n\n${sections.join("\n")}`;
}

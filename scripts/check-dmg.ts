import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_NAME = "Ganger.app";

export interface ExtendedAttribute {
  path: string;
  name: string;
}

export interface MountedVolume {
  names: ReadonlyArray<string>;
  applicationsLink: string | null;
  dsStore: Buffer | null;
  appAttributes: ReadonlyArray<ExtendedAttribute>;
}

const BACKGROUND_NAMES = [".background.tiff", ".background.png"];
const DS_STORE_RECORDS = ["Iloc", "bwsp", "icvp"];
const CODESIGN_REJECTED_ATTRIBUTES = new Set(["com.apple.FinderInfo", "com.apple.ResourceFork"]);

function utf16be(text: string): Buffer {
  return Buffer.from(text, "utf16le").swap16();
}

export function parseRecursiveXattr(output: string, root: string): ExtendedAttribute[] {
  const attributes: ExtendedAttribute[] = [];
  for (const line of output.split("\n")) {
    const separator = line.lastIndexOf(": ");
    if (separator === -1) continue;
    const path = line.slice(0, separator);
    const name = line.slice(separator + 2);
    if (path !== root && !path.startsWith(`${root}/`)) continue;
    attributes.push({ path: join(APP_NAME, relative(root, path)), name });
  }
  return attributes;
}

export function dmgProblems(volume: MountedVolume): string[] {
  const problems: string[] = [];
  if (!volume.names.includes(APP_NAME)) problems.push(`${APP_NAME} is missing`);
  for (const { path, name } of volume.appAttributes) {
    if (CODESIGN_REJECTED_ATTRIBUTES.has(name)) {
      problems.push(`${path} has the ${name} xattr, which codesign --strict rejects`);
    }
  }
  if (volume.applicationsLink !== "/Applications") {
    problems.push("Applications is not a link to /Applications");
  }
  if (!BACKGROUND_NAMES.some((name) => volume.names.includes(name))) {
    problems.push("background image is missing");
  }
  if (!volume.names.includes(".VolumeIcon.icns")) problems.push("volume icon is missing");
  if (volume.dsStore === null) {
    problems.push(".DS_Store is missing");
    return problems;
  }
  for (const record of DS_STORE_RECORDS) {
    if (!volume.dsStore.includes(record, 0, "latin1")) {
      problems.push(`.DS_Store has no ${record} record`);
    }
  }
  for (const name of [APP_NAME, "Applications"]) {
    if (!volume.dsStore.includes(utf16be(name))) {
      problems.push(`.DS_Store has no icon position for ${name}`);
    }
  }
  return problems;
}

export function readVolume(mount: string): MountedVolume {
  const link = join(mount, "Applications");
  const dsStore = join(mount, ".DS_Store");
  const app = join(mount, APP_NAME);
  return {
    names: readdirSync(mount),
    applicationsLink: lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()
      ? readlinkSync(link)
      : null,
    dsStore: existsSync(dsStore) ? readFileSync(dsStore) : null,
    appAttributes: existsSync(app) ? parseRecursiveXattr(xattrRecursive(app), app) : [],
  };
}

function xattrRecursive(path: string): string {
  const result = spawnSync("xattr", ["-r", path], { stdio: ["ignore", "pipe", "inherit"] });
  if (result.status !== 0) throw new Error(`xattr -r exited with ${result.status ?? "unknown"}`);
  return result.stdout.toString();
}

function codesign(args: ReadonlyArray<string>): string | null {
  const result = spawnSync("codesign", args, { stdio: ["ignore", "ignore", "pipe"] });
  return result.status === 0 ? null : result.stderr.toString().trim();
}

export function adHocSignedCopyProblem(app: string): string | null {
  const work = mkdtempSync(join(tmpdir(), "ganger-dmg-codesign-"));
  try {
    const copy = join(work, APP_NAME);
    const ditto = spawnSync("ditto", [app, copy], { stdio: ["ignore", "ignore", "inherit"] });
    if (ditto.status !== 0) return `ditto exited with ${ditto.status ?? "unknown"}`;
    const failure =
      codesign(["--sign", "-", "--force", "--deep", copy]) ??
      codesign(["--verify", "--deep", "--strict", copy]);
    return failure === null
      ? null
      : `${APP_NAME} fails codesign --verify --deep --strict after ad-hoc signing:\n  ${failure}`;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function hdiutil(args: ReadonlyArray<string>): Error | null {
  const result = spawnSync("hdiutil", args, { stdio: ["ignore", "ignore", "inherit"] });
  return result.status === 0
    ? null
    : new Error(`hdiutil ${args[0] ?? ""} exited with ${result.status ?? "unknown"}`);
}

export function checkDmg(dmg: string): void {
  const mount = mkdtempSync(join(tmpdir(), "ganger-dmg-check-"));
  const attachError = hdiutil([
    "attach",
    dmg,
    "-nobrowse",
    "-readonly",
    "-noautoopen",
    "-mountpoint",
    mount,
  ]);
  if (attachError !== null) throw attachError;
  let problems: string[];
  let detachError: Error | null = null;
  try {
    problems = dmgProblems(readVolume(mount));
    const app = join(mount, APP_NAME);
    if (existsSync(app)) {
      const signProblem = adHocSignedCopyProblem(app);
      if (signProblem !== null) problems.push(signProblem);
    }
  } finally {
    detachError = hdiutil(["detach", mount]);
    if (detachError === null) rmSync(mount, { recursive: true, force: true });
  }
  if (detachError !== null) throw detachError;
  if (problems.length > 0) {
    throw new Error(`${dmg} failed the dmg check:\n- ${problems.join("\n- ")}`);
  }
  console.log(`dmg install window and app attributes: ok (${dmg})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dmg = process.argv[2];
  if (dmg === undefined) throw new Error("Usage: node scripts/check-dmg.ts <path.dmg>");
  checkDmg(dmg);
}

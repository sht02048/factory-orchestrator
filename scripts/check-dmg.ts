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
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_NAME = "Ganger.app";

export interface MountedVolume {
  names: ReadonlyArray<string>;
  applicationsLink: string | null;
  dsStore: Buffer | null;
}

const BACKGROUND_NAMES = [".background.tiff", ".background.png"];
const DS_STORE_RECORDS = ["Iloc", "bwsp", "icvp"];

function utf16be(text: string): Buffer {
  return Buffer.from(text, "utf16le").swap16();
}

export function dmgProblems(volume: MountedVolume): string[] {
  const problems: string[] = [];
  if (!volume.names.includes(APP_NAME)) problems.push(`${APP_NAME} is missing`);
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
  return {
    names: readdirSync(mount),
    applicationsLink: lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()
      ? readlinkSync(link)
      : null,
    dsStore: existsSync(dsStore) ? readFileSync(dsStore) : null,
  };
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
  } finally {
    detachError = hdiutil(["detach", mount]);
    if (detachError === null) rmSync(mount, { recursive: true, force: true });
  }
  if (detachError !== null) throw detachError;
  if (problems.length > 0) {
    throw new Error(`${dmg} has no install window:\n- ${problems.join("\n- ")}`);
  }
  console.log(`dmg install window: ok (${dmg})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dmg = process.argv[2];
  if (dmg === undefined) throw new Error("Usage: node scripts/check-dmg.ts <path.dmg>");
  checkDmg(dmg);
}

import { join } from "node:path";

const ICON_COMPOSER_MIN_MAJOR = 26;

export function actoolMajorVersion(versionOutput: string): number | null {
  const match = /<key>short-bundle-version<\/key>\s*<string>(\d+)(?:\.\d+)*<\/string>/.exec(
    versionOutput,
  );
  return match?.[1] === undefined ? null : Number(match[1]);
}

export function appIconPaths(iconsDir: string, actoolVersionOutput: string | null): string[] {
  const icns = join(iconsDir, "icon.icns");
  const major = actoolVersionOutput === null ? null : actoolMajorVersion(actoolVersionOutput);
  return major !== null && major >= ICON_COMPOSER_MIN_MAJOR
    ? [icns, join(iconsDir, "AppIcon.icon")]
    : [icns];
}

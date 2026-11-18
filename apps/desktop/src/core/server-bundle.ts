import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";

export const SERVER_BUNDLE_ENV = "FACTORY_SERVER_BUNDLE";

const bundlePackageSchema = z.object({ name: z.string(), version: z.string() });

export interface ServerBundle {
  root: string;
  cliEntry: string;
  version: string;
  buildId: string;
}

export class ServerBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerBundleError";
  }
}

export function loadServerBundle(root: string): ServerBundle {
  const cliEntry = join(root, "cli", "bin", "cli.js");
  const packageFile = join(root, "package.json");
  if (!existsSync(cliEntry) || !existsSync(packageFile)) {
    throw new ServerBundleError(
      `server bundle not found at ${root} (run pnpm build && pnpm run bundle)`,
    );
  }
  const parsed = bundlePackageSchema.safeParse(JSON.parse(readFileSync(packageFile, "utf8")));
  if (!parsed.success) throw new ServerBundleError(`${packageFile} has no name and version`);
  return {
    root,
    cliEntry,
    version: parsed.data.version,
    buildId: bundleBuildId(root, parsed.data.version),
  };
}

export function bundleBuildId(root: string, version: string): string {
  const hash = createHash("sha256");
  for (const file of listFiles(root)) {
    hash.update(relative(root, file));
    hash.update("\u0000");
    hash.update(readFileSync(file));
    hash.update("\u0000");
  }
  return `${version}+${hash.digest("hex").slice(0, 12)}`;
}

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

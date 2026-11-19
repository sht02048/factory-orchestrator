import { z } from "zod";

const VERSION =
  /^v?(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export const REPOSITORY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export const repositorySchema = z
  .string()
  .trim()
  .regex(REPOSITORY_PATTERN)
  .refine((value) => !value.endsWith("/.") && !value.endsWith("/.."));

export const UPDATE_FEED_PREFIX = "ganger-update-darwin-";

export function updateFeedName(arch: string): string {
  return `${UPDATE_FEED_PREFIX}${arch}.json`;
}

export function updateZipName(version: string, arch: string): string {
  return `Ganger-${version}-darwin-${arch}.zip`;
}

export function releasesApiUrl(repository: string): string {
  return `https://api.github.com/repos/${repository}/releases?per_page=30`;
}

export function releasesPageUrl(repository: string): string {
  return `https://github.com/${repository}/releases`;
}

interface ParsedVersion {
  core: [number, number, number];
  pre: ReadonlyArray<string>;
}

function parse(version: string): ParsedVersion | null {
  const groups = VERSION.exec(version.trim())?.groups;
  if (groups === undefined) return null;
  const pre = groups["pre"];
  return {
    core: [Number(groups["major"]), Number(groups["minor"]), Number(groups["patch"])],
    pre: pre === undefined ? [] : pre.split("."),
  };
}

export function normalizeVersion(version: string): string | null {
  return parse(version) === null ? null : version.trim().replace(/^v/, "");
}

export function isPrerelease(version: string): boolean {
  return (parse(version)?.pre.length ?? 0) > 0;
}

function compareIdentifier(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  if (left === null || right === null) throw new Error(`not a version: ${left === null ? a : b}`);
  const core =
    left.core[0] - right.core[0] || left.core[1] - right.core[1] || left.core[2] - right.core[2];
  if (core !== 0) return Math.sign(core);
  if (left.pre.length === 0 || right.pre.length === 0) {
    return Math.sign(right.pre.length - left.pre.length);
  }
  for (let index = 0; index < Math.min(left.pre.length, right.pre.length); index += 1) {
    const order = compareIdentifier(left.pre[index] ?? "", right.pre[index] ?? "");
    if (order !== 0) return Math.sign(order);
  }
  return Math.sign(left.pre.length - right.pre.length);
}

const httpsUrl = z.url({ protocol: /^https$/ });

const releaseSchema = z.object({
  tag_name: z.string(),
  html_url: httpsUrl,
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(z.object({ name: z.string(), browser_download_url: httpsUrl })).catch([]),
});

export const releasesSchema = z.array(z.unknown());

export interface AvailableRelease {
  version: string;
  notesUrl: string;
  feedUrl: string;
}

export function newestRelease(
  raw: unknown,
  current: string,
  arch: string,
): AvailableRelease | null {
  const list = releasesSchema.parse(raw);
  const includePrerelease = isPrerelease(current);
  const feed = updateFeedName(arch);
  let best: AvailableRelease | null = null;
  for (const item of list) {
    const parsed = releaseSchema.safeParse(item);
    if (!parsed.success) continue;
    const release = parsed.data;
    if (release.draft) continue;
    const version = normalizeVersion(release.tag_name);
    if (version === null) continue;
    if (release.prerelease !== isPrerelease(version)) continue;
    if (release.prerelease && !includePrerelease) continue;
    if (compareVersions(version, current) <= 0) continue;
    if (best !== null && compareVersions(version, best.version) <= 0) continue;
    const feedUrl = release.assets.find((asset) => asset.name === feed)?.browser_download_url;
    if (feedUrl === undefined) continue;
    best = { version, notesUrl: release.html_url, feedUrl };
  }
  return best;
}

export interface SquirrelFeedInput {
  version: string;
  zipUrl: string;
  notesUrl: string;
  publishedAt: string;
}

export function squirrelFeed({ version, zipUrl, notesUrl, publishedAt }: SquirrelFeedInput) {
  const updateTo = { version, name: version, notes: notesUrl, pub_date: publishedAt, url: zipUrl };
  return { currentRelease: version, releases: [{ version, updateTo }] };
}

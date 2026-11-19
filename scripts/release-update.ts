import {
  compareVersions,
  normalizeVersion,
  repositorySchema,
  squirrelFeed,
  updateFeedName,
  updateZipName,
} from "../packages/app/src/updates/releases.ts";

export const MANUAL_UPDATE_NOTICE_BEFORE = "0.3.0";

export const MANUAL_UPDATE_NOTICE = [
  "> [!IMPORTANT]",
  "> **Installed 0.1.0 or an earlier build? Download the dmg below once.** Those builds cannot update themselves. Open the dmg, drag Ganger to Applications to replace the old app, and open it again. From this version on, the app checks GitHub Releases in the background, downloads new versions, and asks before it restarts. The server the app started is replaced together with the app, and running runs continue on their runners.",
].join("\n");

export function releaseRepository(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  for (const name of ["GANGER_RELEASE_REPOSITORY", "GITHUB_REPOSITORY"]) {
    const value = env[name];
    if (value === undefined || value.trim() === "") continue;
    const parsed = repositorySchema.safeParse(value);
    if (!parsed.success) throw new Error(`${name} must look like owner/name, got ${value}`);
    return parsed.data;
  }
  return null;
}

export interface UpdateArtifactsInput {
  repository: string;
  tag: string;
  version: string;
  arch: string;
  publishedAt: string;
}

export interface UpdateArtifacts {
  zipName: string;
  feedName: string;
  feed: string;
}

export function updateArtifacts(input: UpdateArtifactsInput): UpdateArtifacts {
  if (normalizeVersion(input.tag) !== input.version) {
    throw new Error(`tag ${input.tag} does not match version ${input.version}`);
  }
  const zipName = updateZipName(input.version, input.arch);
  const base = `https://github.com/${input.repository}/releases`;
  const feed = squirrelFeed({
    version: input.version,
    zipUrl: `${base}/download/${input.tag}/${zipName}`,
    notesUrl: `${base}/tag/${input.tag}`,
    publishedAt: input.publishedAt,
  });
  return {
    zipName,
    feedName: updateFeedName(input.arch),
    feed: `${JSON.stringify(feed, null, 2)}\n`,
  };
}

export function manualUpdateNotice(version: string): string | null {
  return compareVersions(version, MANUAL_UPDATE_NOTICE_BEFORE) < 0 ? MANUAL_UPDATE_NOTICE : null;
}

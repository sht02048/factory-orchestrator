import { resolve, sep } from "node:path";

interface RenderedChunk {
  fileName: string;
}

const HOME_PATH = /(?<![\w.-])(?:\/Users\/|\/home\/|[A-Za-z]:\\\\?Users\\\\?)[A-Za-z0-9._-]+[/\\]/g;

export function withTrailingSeparator(root: string): string {
  const absolute = resolve(root);
  return absolute.endsWith(sep) ? absolute : `${absolute}${sep}`;
}

export function stripBuildRoot(source: string, root: string): string {
  return source.replaceAll(withTrailingSeparator(root), "");
}

export function relativeBuildPaths(root: string) {
  return {
    name: "ganger-relative-build-paths",
    renderChunk(code: string, _chunk: RenderedChunk) {
      const stripped = stripBuildRoot(code, root);
      return stripped === code ? null : { code: stripped, map: null };
    },
  };
}

export function buildMachinePaths(source: string, roots: readonly string[] = []): string[] {
  const found = new Set<string>();
  for (const root of roots) {
    if (source.includes(withTrailingSeparator(root))) found.add(resolve(root));
  }
  for (const match of source.matchAll(HOME_PATH)) found.add(match[0]);
  return [...found].toSorted();
}

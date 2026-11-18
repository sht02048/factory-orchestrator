import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";

/*
 * 앱이 싣는 서버 배포물(0029 `pnpm run bundle` 의 폴더). 앱은 배포물을 고치지 않고 리소스로 싣는다.
 * 패키징한 앱은 `Contents/Resources/server/`, 개발 실행은 저장소 `dist/factory-orchestrator-<version>/` 을 쓴다.
 */

export const SERVER_BUNDLE_ENV = "FACTORY_SERVER_BUNDLE";

const bundlePackageSchema = z.object({ name: z.string(), version: z.string() });

export interface ServerBundle {
  root: string;
  /** CLI 진입 파일. `start`·`init` 을 이것으로 돌린다 */
  cliEntry: string;
  /** 제품 버전(배포물 package.json) */
  version: string;
  /**
   * 배포물 내용의 지문. 앱이 띄운 ②의 서버 코드가 앱에 실린 것과 다른지 이것으로 가린다. 버전 문자열만 보면
   * 같은 버전으로 다시 만든 배포물(개발 빌드)의 차이를 놓친다.
   */
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

/** 파일 경로와 내용을 차례로 해시한다. 배포물은 수 MB 라 앱이 뜰 때 한 번 계산해도 짧다 */
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

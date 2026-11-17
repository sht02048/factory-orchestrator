import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * 번들에 마이그레이션 SQL을 함께 싣는 빌드 플러그인(Vite·Rolldown·Rollup 공통 훅만 쓴다).
 *
 * migrate.ts는 마이그레이션 폴더를 자기 모듈 위치에서 `../drizzle`로 찾는다. 번들하면 그 코드가 든 청크의
 * 위치가 기준이 되는데 SQL 파일은 따라오지 않아, 프로덕션 실행에서 폴더를 찾지 못한다.
 * 이 플러그인은 migrate.ts가 들어간 청크를 찾아 그 청크 기준 `../drizzle/<이름>/migration.sql`에 원본 파일을
 * 그대로 내보낸다. 파일 내용이 같아 해시도 같다. 청크 위치를 산출물에서 직접 계산하므로 번들러가 청크를
 * 어디에 두든 맞는다.
 */

// Vite가 설정 파일을 Node로 바로 읽어 `./migrate.js` 같은 import를 풀지 못한다. 그래서 이 모듈은 다른 소스를
// import하지 않고 값을 따로 둔다. migrate.ts의 MIGRATIONS_FOLDER와 같은지는 시험이 지킨다.
const MIGRATE_MODULE = fileURLToPath(new URL("./migrate.ts", import.meta.url));
/** migrate.ts가 자기 위치에서 마이그레이션 폴더를 찾는 상대 경로 */
export const MIGRATIONS_FROM_MODULE = "../drizzle";
const MIGRATIONS_FOLDER = fileURLToPath(new URL(MIGRATIONS_FROM_MODULE, import.meta.url));

/** 번들 산출물 중 이 플러그인이 보는 부분. Vite·Rolldown·Rollup의 `OutputBundle` 값과 맞는다. */
type BundleOutput =
  | { type: "chunk"; fileName: string; moduleIds: ReadonlyArray<string> }
  | { type: "asset" };

interface EmitContext {
  emitFile(file: { type: "asset"; fileName: string; source: Uint8Array }): string;
}

export class BundleMigrationsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleMigrationsError";
  }
}

/**
 * 번들에 내보낼 마이그레이션 파일 경로(산출물 폴더 기준)와 원본 경로.
 * migrate.ts가 든 청크가 없으면(예: 브라우저 번들) 빈 배열이다.
 */
export function migrationOutputs(
  bundle: Readonly<Record<string, BundleOutput>>,
  folder: string = MIGRATIONS_FOLDER,
): Array<{ fileName: string; source: string }> {
  const targets = new Set(
    Object.values(bundle).flatMap((output) =>
      output.type === "chunk" && output.moduleIds.includes(MIGRATE_MODULE)
        ? [posix.join(posix.dirname(output.fileName), MIGRATIONS_FROM_MODULE)]
        : [],
    ),
  );
  const outputs: Array<{ fileName: string; source: string }> = [];
  for (const target of targets) {
    if (target === ".." || target.startsWith("../")) {
      throw new BundleMigrationsError(
        `migrations would land outside the output directory (${target}); place the chunk with migrate.ts in a subdirectory`,
      );
    }
    for (const name of readdirSync(folder).toSorted()) {
      // drizzle의 readMigrationFiles처럼 migration.sql이 있는 폴더만 마이그레이션으로 본다.
      const source = join(folder, name, "migration.sql");
      if (!existsSync(source)) continue;
      outputs.push({ fileName: posix.join(target, name, "migration.sql"), source });
    }
  }
  return outputs;
}

/** 번들러 설정의 `plugins`에 넣는다. */
export function bundleMigrations() {
  return {
    name: "factory-bundle-migrations",
    generateBundle(this: EmitContext, _options: unknown, bundle: Record<string, BundleOutput>) {
      for (const { fileName, source } of migrationOutputs(bundle)) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(source) });
      }
    },
  };
}

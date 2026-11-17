import { defineConfig } from "drizzle-kit";

// 마이그레이션 SQL을 만든다: pnpm --filter @factory/db db:generate
// 만든 SQL은 커밋하고, 실행은 src/migrate.ts의 migrate()가 맡는다.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
});

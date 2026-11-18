import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

/*
 * 앱 설정. 앱 데이터 폴더의 `settings.json` 에 둔다. 서버 설정(DB)과 다르다. 모드, 원격 모드에서 고른 서버,
 * 로그인 때 실행, 서버 찾기 포트를 기억한다. 읽지 못하면 첫 실행처럼 다룬다.
 */

export const appSettingsSchema = z.object({
  /** 없으면 첫 실행이다 */
  mode: z.enum(["local", "remote"]).optional(),
  remote: z.object({ instanceId: z.string(), name: z.string(), url: z.string() }).optional(),
  /** 로컬 모드: 로그인 때 앱을 띄워 ②를 띄운다(Q5, 기본 켬) */
  openAtLogin: z.boolean().optional(),
  /** 서버 찾기가 묻는 http 포트. 없으면 3000 */
  discoveryPort: z.number().int().min(1).max(65_535).optional(),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export interface SettingsStore {
  read(): AppSettings;
  write(settings: AppSettings): void;
}

export function fileSettingsStore(path: string): SettingsStore {
  return {
    read: () => {
      try {
        const parsed = appSettingsSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
        return parsed.success ? parsed.data : {};
      } catch {
        return {};
      }
    },
    write: (settings) => {
      mkdirSync(dirname(path), { recursive: true });
      // 쓰다 끊겨도 반쪽 파일이 남지 않게 옆에 쓰고 바꾼다.
      const temp = `${path}.tmp`;
      writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`);
      renameSync(temp, path);
    },
  };
}

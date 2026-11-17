import { z } from "zod";

/** macOS 앱 설치의 orca CLI 경로. 비대화형 ssh의 PATH에는 없다(research 0003 6절, 0002 A.8). */
export const DEFAULT_ORCA_PATH = "/Applications/Orca.app/Contents/Resources/bin/orca";

/**
 * Orca 러너 하나의 설정. DB에 저장한 러너 설정(`config`)을 factory가 이 스키마로 파싱한다.
 * 환경 값(호스트 이름, 경로)은 운영자가 넣는다. 저장소에는 기본값만 둔다(ADR 0005).
 */
export const orcaRunnerConfigSchema = z.object({
  /** ssh 대상. ssh config의 Host 별칭이나 `user@host`. 로컬 ssh의 옵션으로 읽히지 않게 `-`로 시작하지 못한다 */
  sshTarget: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !value.startsWith("-"), { error: "must not start with '-'" }),
  /** 러너의 orca 실행 파일 절대 경로 */
  orcaPath: z.string().trim().min(1).default(DEFAULT_ORCA_PATH),
  /** 에이전트 모델. 없으면 러너의 Orca 설정을 따른다(`worker-start --model`) */
  model: z.string().trim().min(1).optional(),
  /** ssh 연결 제한 시간(초) */
  connectTimeoutSeconds: z.number().int().positive().default(10),
  /** 명령 하나의 제한 시간(밀리초). 넘으면 ssh를 끊는다 */
  commandTimeoutMs: z.number().int().positive().default(60_000),
  /** 에이전트 시작(`worker-start`)의 제한 시간(밀리초). 워크트리를 만들고 에이전트를 띄우므로 길다 */
  startTimeoutMs: z.number().int().positive().default(180_000),
});

export type OrcaRunnerConfig = z.infer<typeof orcaRunnerConfigSchema>;

/** 러너 설정이 틀림. 메시지에는 값 자체를 넣지 않는다. */
export class OrcaRunnerConfigError extends Error {
  constructor(issues: ReadonlyArray<string>) {
    super(`orca runner configuration is invalid: ${issues.join("; ")}`);
    this.name = "OrcaRunnerConfigError";
  }
}

export function parseOrcaRunnerConfig(config: unknown): OrcaRunnerConfig {
  const parsed = orcaRunnerConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new OrcaRunnerConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`),
    );
  }
  return parsed.data;
}

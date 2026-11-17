import type { CodeHostFactory } from "@factory/core";
import { z } from "zod";
import { GITHUB_KIND, GitHubCodeHost } from "./github.js";
import type { GitHubCodeHostOptions } from "./github.js";

export { GITHUB_KIND, GitHubCodeHost, searchQuery } from "./github.js";
export type { GitHubCodeHostOptions } from "./github.js";
export { GitHubError } from "./http.js";
export { summarizeRuns } from "./ci.js";

/**
 * 앱이 넘기는 설정 `{ config, secrets }`(apps/worker `WorkerAdapters`). GitHub 연결은 토큰 하나만 쓴다.
 * 토큰은 PR 상태에 Metadata·Pull requests 읽기가 필요하고, Actions 읽기는 선택이다(스펙 9절, Q79).
 */
const settings = z.object({
  secrets: z.object({ token: z.string().min(1) }),
});

/**
 * GitHub 코드 호스트 factory. 앱이 시작할 때 `registry.registerCodeHost(...)`로 등록한다.
 * 테스트에서는 `fetch`를 바꿔 끼운다.
 */
export function createGitHubCodeHostFactory(
  overrides: Omit<GitHubCodeHostOptions, "token"> = {},
): CodeHostFactory {
  return {
    kind: GITHUB_KIND,
    create(config: unknown) {
      const parsed = settings.parse(config);
      return new GitHubCodeHost({ ...overrides, token: parsed.secrets.token });
    },
  };
}

export const githubCodeHostFactory: CodeHostFactory = createGitHubCodeHostFactory();

import type { CodeHostFactory } from "@ganger/core";
import { z } from "zod";
import { GITHUB_KIND, GitHubCodeHost } from "./github.js";
import type { GitHubCodeHostOptions } from "./github.js";

export { GITHUB_KIND, GitHubCodeHost, searchQuery } from "./github.js";
export type { GitHubCodeHostOptions } from "./github.js";
export { GitHubError } from "./http.js";
export { summarizeRuns } from "./ci.js";

const settings = z.object({
  secrets: z.object({ token: z.string().min(1) }),
});

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

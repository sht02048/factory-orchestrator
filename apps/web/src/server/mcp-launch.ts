import { isAbsolute } from "node:path";
import {
  CLI_ENTRY_ENV,
  ELECTRON_RUN_AS_NODE_ENV,
  mcpLaunch,
} from "@ganger/app/settings/mcp-launch";
import type { McpLaunch } from "@ganger/app/settings/mcp-launch";
import { HOME_ENV } from "@ganger/cli/home";
import { z } from "zod";

const absolutePath = z.string().trim().min(1).refine(isAbsolute);

const launchEnvSchema = z.object({
  [CLI_ENTRY_ENV]: absolutePath.optional().catch(undefined),
  [HOME_ENV]: absolutePath.optional().catch(undefined),
  [ELECTRON_RUN_AS_NODE_ENV]: z.string().optional(),
});

export function serverMcpLaunch(
  env: Readonly<Record<string, string | undefined>>,
  nodePath: string,
): McpLaunch {
  const parsed = launchEnvSchema.parse(env);
  return mcpLaunch({
    nodePath,
    cliEntry: parsed[CLI_ENTRY_ENV],
    home: parsed[HOME_ENV],
    electron: parsed[ELECTRON_RUN_AS_NODE_ENV] === "1",
  });
}

export const MCP_SERVER_KEY = "ganger";
export const CLI_ENTRY_ENV = "GANGER_CLI_ENTRY";
export const ELECTRON_RUN_AS_NODE_ENV = "ELECTRON_RUN_AS_NODE";

export interface McpLaunch {
  located: boolean;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function mcpLaunch(input: {
  nodePath: string;
  cliEntry: string | undefined;
  home: string | undefined;
  electron: boolean;
}): McpLaunch {
  const homeArgs = input.home === undefined ? [] : ["--home", input.home];
  if (input.cliEntry === undefined) {
    return { located: false, command: "ganger", args: ["mcp", ...homeArgs], env: {} };
  }
  return {
    located: true,
    command: input.nodePath,
    args: [input.cliEntry, "mcp", ...homeArgs],
    env: input.electron ? { [ELECTRON_RUN_AS_NODE_ENV]: "1" } : {},
  };
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function hermesConfig(launch: McpLaunch): string {
  const lines = [
    "mcp_servers:",
    `  ${MCP_SERVER_KEY}:`,
    `    command: ${yamlString(launch.command)}`,
    "    args:",
    ...launch.args.map((arg) => `      - ${yamlString(arg)}`),
  ];
  const env = Object.entries(launch.env);
  if (env.length > 0) {
    lines.push("    env:", ...env.map(([name, value]) => `      ${name}: ${yamlString(value)}`));
  }
  return lines.join("\n");
}

export function jsonConfig(launch: McpLaunch): string {
  const server = {
    command: launch.command,
    args: launch.args,
    ...(Object.keys(launch.env).length === 0 ? {} : { env: launch.env }),
  };
  return JSON.stringify({ mcpServers: { [MCP_SERVER_KEY]: server } }, null, 2);
}

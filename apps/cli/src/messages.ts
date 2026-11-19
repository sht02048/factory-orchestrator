export const messages = {
  usage: `Usage: ganger <command> [options]

Commands:
  init                 Write boot settings (.env) with a new encryption key.
                       Leaves an existing .env untouched.
  start                Apply database migrations, then run the web server and the worker.
  service install      Register start as a background service (launchd on macOS, systemd on Linux).
  service uninstall    Stop and remove the background service.
  mcp                  Run an MCP server on stdin and stdout that reads Ganger's state.
                       Start it from an MCP client on this machine.

Options:
  --home <dir>         Installation folder for .env, data, and logs
                       (default: $GANGER_HOME, or ~/.ganger)
  --host <address>     init: address the web server binds to (default: 127.0.0.1)
  --port <port>        init: port the web server listens on (default: 3000)
  --database-path <p>  init: SQLite file (default: <home>/data/ganger.db)
  --dry-run            service: print what would be written and run, and change nothing
  -h, --help           Show this help`,

  init: {
    created: (envFile: string) => `Wrote boot settings to ${envFile} with a new encryption key.`,
    summary: (host: string, port: number, databasePath: string) =>
      `  web: ${host}:${port}\n  database: ${databasePath}`,
    exists: (envFile: string) =>
      `Boot settings already exist at ${envFile}. Left them unchanged, including the encryption key.`,
    next: "Next: run `ganger start`, then open the web address to finish onboarding.",
  },

  mcp: {
    noDatabase: (path: string) =>
      `The database ${path} does not exist yet. Start the server first (ganger start).`,
    databaseBehind: (missing: ReadonlyArray<string>) =>
      `The database is older than this version of Ganger (missing migrations: ${missing.join(", ")}). Start the server first (ganger start); it updates the database.`,
    databaseAhead: (unknown: ReadonlyArray<string>) =>
      `The database is newer than this version of Ganger (unknown migrations: ${unknown.join(", ")}). Update Ganger, then point your MCP client at the new version.`,
    databaseEdited: (changed: ReadonlyArray<string>) =>
      `The database was migrated by a different build of Ganger (changed migrations: ${changed.join(", ")}). Update Ganger to the version the server runs.`,
  },

  start: {
    config: (envFile: string, databasePath: string) =>
      `Boot settings: ${envFile}\nDatabase: ${databasePath}`,
    migrated: (names: ReadonlyArray<string>) =>
      names.length === 0
        ? "Database is up to date."
        : `Applied ${names.length} database migration(s): ${names.join(", ")}`,
    ready: (url: string) => `Web is listening at ${url}. The worker is running.`,
    stopping: (signal: string) => `${signal} received, stopping the web server and the worker.`,
    stopped: "Stopped.",
    childFailed: (reason: string) => `Stopping because ${reason}.`,
  },

  service: {
    unsupported: (platform: string) =>
      `Service registration supports macOS (launchd) and Linux (systemd), not ${platform}.`,
    dryRunHeader: "Dry run: nothing was written or run.",
    wouldCreateDirectories: "Would create these folders if missing:",
    wouldWrite: (path: string) => `Would write ${path}:`,
    wouldRun: "Would run:",
    wouldRunBeforeRemove: "Would run:",
    wouldRemove: (path: string) => `Would remove ${path}`,
    wouldRunAfterRemove: "Then would run:",
    installed: (path: string) => `Installed and started the service from ${path}.`,
    nodeNote: (nodePath: string) =>
      `The service runs ${nodePath}. If you remove or upgrade this Node installation, run service uninstall and service install again.`,
    launchdLogs: (logDir: string) => `Logs: ${logDir}`,
    systemdLogs: (unit: string) => `Logs: journalctl --user -u ${unit}`,
    linger:
      "systemd stops user services when you log out. To keep it running, run: loginctl enable-linger",
    notInstalled: (path: string) => `No service is installed (${path} does not exist).`,
    uninstalled: (path: string) => `Stopped the service and removed ${path}.`,
    removedWithWarnings: (path: string) =>
      `Removed ${path}, but stopping the service failed (see above). Check it with launchctl or systemctl.`,
    commandFailed: (command: string, output: string) =>
      `Warning: ${command} failed:\n${output.trim()}`,
    needsInit: "Run `ganger init` before installing the service.",
  },

  errors: {
    unknownCommand: (command: string) => `Unknown command: ${command}`,
    optionNotFor: (options: string, command: string) => `${options} cannot be used with ${command}`,
    missingEnvFile: (envFile: string) =>
      `Boot settings not found at ${envFile}. Run \`ganger init\` first.`,
  },
} as const;

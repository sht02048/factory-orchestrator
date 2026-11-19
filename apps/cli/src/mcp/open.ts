import { existsSync } from "node:fs";
import { checkSchema, openDatabase } from "@ganger/db";
import type { Database, Migration } from "@ganger/db";
import { messages } from "../messages.js";

export class McpStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpStartError";
  }
}

export function openMcpDatabase(
  databasePath: string,
  migrations?: ReadonlyArray<Migration>,
): Database {
  if (!existsSync(databasePath)) throw new McpStartError(messages.mcp.noDatabase(databasePath));
  const db = openDatabase(databasePath);
  const check = checkSchema(db, migrations);
  if (check.kind === "current") return db;
  db.$client.close();
  switch (check.kind) {
    case "behind":
      throw new McpStartError(messages.mcp.databaseBehind(check.missing));
    case "ahead":
      throw new McpStartError(messages.mcp.databaseAhead(check.unknown));
    case "edited":
      throw new McpStartError(messages.mcp.databaseEdited(check.changed));
  }
}

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

export function schemaProblem(db: Database, migrations?: ReadonlyArray<Migration>): string | null {
  const check = checkSchema(db, migrations);
  switch (check.kind) {
    case "current":
      return null;
    case "behind":
      return messages.mcp.databaseBehind(check.missing);
    case "ahead":
      return messages.mcp.databaseAhead(check.unknown);
    case "edited":
      return messages.mcp.databaseEdited(check.changed);
  }
}

export function openMcpDatabase(
  databasePath: string,
  migrations?: ReadonlyArray<Migration>,
): Database {
  if (!existsSync(databasePath)) throw new McpStartError(messages.mcp.noDatabase(databasePath));
  const db = openDatabase(databasePath);
  let problem;
  try {
    problem = schemaProblem(db, migrations);
  } catch (error) {
    db.$client.close();
    throw error;
  }
  if (problem === null) return db;
  db.$client.close();
  throw new McpStartError(problem);
}

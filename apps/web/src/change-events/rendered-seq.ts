import { createIsomorphicFn } from "@tanstack/react-start";
import { latestChangeSeq } from "@ganger/db";
import { getDatabase } from "../server/database";

export const renderedChangeSeq = createIsomorphicFn()
  .server((): number | null => latestChangeSeq(getDatabase()))
  .client((): number | null => null);

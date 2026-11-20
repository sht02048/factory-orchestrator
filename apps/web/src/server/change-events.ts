import { changeResumeFrom, latestChangeSeq, listChangesAfter } from "@ganger/db";
import type { Database } from "@ganger/db";
import { ChangeFeed } from "../change-events/feed";
import type { ChangeSource } from "../change-events/feed";
import { getDatabase } from "./database";

export function changeSourceOf(db: Database): ChangeSource {
  return {
    latest: () => latestChangeSeq(db),
    after: (seq, limit) => listChangesAfter(db, seq, limit),
    resume: (after) => changeResumeFrom(db, after),
  };
}

let feed: ChangeFeed | undefined;

export function getChangeFeed(): ChangeFeed {
  feed ??= new ChangeFeed(changeSourceOf(getDatabase()));
  return feed;
}

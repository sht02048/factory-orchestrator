export const CHANGE_KINDS = [
  "run",
  "runner",
  "assignment",
  "workspace",
  "settings",
  "tracker",
] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const CHANGE_PARTS = ["log"] as const;

export type ChangePart = (typeof CHANGE_PARTS)[number];

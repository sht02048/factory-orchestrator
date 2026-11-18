export type AnswerPick = { kind: "choice"; index: number } | { kind: "other" } | null;

export interface AnswerDraft {
  pick: AnswerPick;
  otherText: string;
}

export const emptyDraft: AnswerDraft = { pick: null, otherText: "" };

export function pickChoice(draft: AnswerDraft, index: number): AnswerDraft {
  return { ...draft, pick: { kind: "choice", index } };
}

export function pickOther(draft: AnswerDraft): AnswerDraft {
  return { ...draft, pick: { kind: "other" } };
}

export function writeOther(draft: AnswerDraft, otherText: string): AnswerDraft {
  return { pick: { kind: "other" }, otherText };
}

export function answerToSend(choices: ReadonlyArray<string>, draft: AnswerDraft): string | null {
  const { pick } = draft;
  if (pick === null) return null;
  if (pick.kind === "other") {
    const text = draft.otherText.trim();
    return text === "" ? null : text;
  }
  return choices[pick.index] ?? null;
}

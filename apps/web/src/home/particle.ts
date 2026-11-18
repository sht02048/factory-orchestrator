const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
const FINAL_CONSONANT_COUNT = 28;
const DIGITS_READ_WITH_FINAL_CONSONANT = new Set(["0", "1", "3", "6", "7", "8"]);
const LETTERS_READ_WITH_FINAL_CONSONANT = new Set(["l", "m", "n", "r"]);

export function endsWithFinalConsonant(word: string): boolean {
  const spoken = /[\p{L}\p{N}]+$/u.exec(word.replace(/[^\p{L}\p{N}]+$/u, ""))?.[0] ?? "";
  const last = spoken.at(-1);
  if (last === undefined) return false;
  const code = last.codePointAt(0) ?? 0;
  if (code >= HANGUL_FIRST && code <= HANGUL_LAST)
    return (code - HANGUL_FIRST) % FINAL_CONSONANT_COUNT !== 0;
  if (/\d/.test(last)) return DIGITS_READ_WITH_FINAL_CONSONANT.has(last);
  const lower = spoken.toLowerCase();
  if (lower.endsWith("ng")) return true;
  return LETTERS_READ_WITH_FINAL_CONSONANT.has(lower.at(-1) ?? "");
}

export function subjectParticle(word: string): "i" | "ga" {
  return endsWithFinalConsonant(word) ? "i" : "ga";
}

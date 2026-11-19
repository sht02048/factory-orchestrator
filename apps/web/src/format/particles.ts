const DIGIT_FINALS: Readonly<Record<string, "none" | "rieul" | "other">> = {
  "0": "other",
  "1": "rieul",
  "2": "none",
  "3": "other",
  "4": "none",
  "5": "none",
  "6": "other",
  "7": "rieul",
  "8": "rieul",
  "9": "none",
};

const LETTER_FINALS: Readonly<Record<string, "none" | "rieul" | "other">> = {
  l: "rieul",
  r: "rieul",
  m: "other",
  n: "other",
};

function finalOf(word: string): "none" | "rieul" | "other" {
  const last = word.trim().slice(-1).toLowerCase();
  return DIGIT_FINALS[last] ?? LETTER_FINALS[last] ?? "none";
}

export interface Particles {
  subject: "이" | "가";
  object: "을" | "를";
  direction: "으로" | "로";
}

export function particlesOf(word: string): Particles {
  const final = finalOf(word);
  return {
    subject: final === "none" ? "가" : "이",
    object: final === "none" ? "를" : "을",
    direction: final === "other" ? "으로" : "로",
  };
}

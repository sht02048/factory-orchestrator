export const HUMAN_CHECK_NOTE_MAX = 10_000;

export function isHumanCheckNoteTooLong(note: string): boolean {
  return Array.from(note).length > HUMAN_CHECK_NOTE_MAX;
}

export interface QuestionChoice {
  marker: string | null;
  text: string;
  answer: string;
}

export interface ReadQuestion {
  lead: string[];
  choices: QuestionChoice[];
  after: string[];
}

interface Item {
  label: string;
  text: string;
}

interface ListParse {
  lead: string;
  items: Item[];
  after: string;
}

const LINE_MARKER = /^\s*(?:\(([A-Za-z]|\d{1,2})\)|([A-Za-z]|\d{1,2})[.)])\s+(.*)$/;
const INLINE_MARKER = /(?<=^|\s)(?:\(([A-Za-z]|\d{1,2})\)|([A-Za-z]|\d{1,2})\))(?=\s)/g;
const SENTENCE_END = /(?<=[.!?。？！])\s+/;
const ASKS = /[?？]/;
const ENDS_ASKING = /[?？]\s*$/;
const ENDS_INTRODUCING = /[:：]\s*$/;

export function readQuestion(body: string, options: ReadonlyArray<string>): ReadQuestion {
  if (options.length > 0) {
    return {
      lead: paragraphsOf(body),
      choices: options.map((option) => ({ marker: null, text: option, answer: option })),
      after: [],
    };
  }
  const list = listOnLines(body) ?? listInline(body);
  if (list === null) return { lead: paragraphsOf(body), choices: [], after: [] };
  return {
    lead: paragraphsOf(list.lead),
    choices: list.items.map(({ label, text }) => ({
      marker: label,
      text,
      answer: `(${label}) ${text}`,
    })),
    after: paragraphsOf(list.after),
  };
}

export function questionSummary(body: string, options: ReadonlyArray<string>): string {
  const { lead, choices } = readQuestion(body, options);
  if (choices.length === 0 || lead.length === 0) return body;
  return lead.join("\n");
}

export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
}

function listOnLines(body: string): ListParse | null {
  const lines = body.split("\n");
  for (let start = 0; start < lines.length; start += 1) {
    const first = lineItem(lines[start] ?? "");
    if (first === null || !startsSequence(first.label)) continue;
    const items: Item[] = [first];
    let end = start + 1;
    while (end < lines.length) {
      const line = lines[end] ?? "";
      const last = items.at(-1);
      if (last === undefined) break;
      const next = lineItem(line);
      if (next !== null && next.label === following(last.label)) {
        items.push(next);
        end += 1;
        continue;
      }
      if (line.trim() === "") {
        const ahead = lines.slice(end).findIndex((rest) => rest.trim() !== "");
        const nextItem = ahead === -1 ? null : lineItem(lines[end + ahead] ?? "");
        if (nextItem !== null && nextItem.label === following(last.label)) {
          end += ahead;
          continue;
        }
        break;
      }
      if (/^\s/.test(line)) {
        last.text = `${last.text} ${line.trim()}`;
        end += 1;
        continue;
      }
      break;
    }
    if (items.length < 2) continue;
    const lead = lines.slice(0, start).join("\n");
    const after = lines.slice(end).join("\n");
    if (!asksRightBefore(lead)) continue;
    return { lead, items, after };
  }
  return null;
}

function listInline(body: string): ListParse | null {
  const markers = [...body.matchAll(INLINE_MARKER)].map((match) => {
    const after = match.index + match[0].length;
    const space = /^\s*/.exec(body.slice(after))?.[0].length ?? 0;
    return { label: match[1] ?? match[2] ?? "", start: match.index, end: after + space };
  });
  for (let first = 0; first < markers.length; first += 1) {
    const head = markers[first];
    if (head === undefined || !startsSequence(head.label)) continue;
    const chain = [head];
    for (const marker of markers.slice(first + 1)) {
      const last = chain.at(-1);
      if (last !== undefined && marker.label === following(last.label)) chain.push(marker);
    }
    if (chain.length < 2) continue;
    const items = chain.map((marker, index) => ({
      label: marker.label,
      text: body.slice(marker.end, chain[index + 1]?.start ?? body.length),
    }));
    const lastItem = items.at(-1);
    if (lastItem === undefined) continue;
    const [lastText, tail] = splitTail(
      lastItem.text,
      items.map((item) => item.label),
    );
    lastItem.text = lastText;
    const lead = body.slice(0, head.start);
    if (!asksRightBefore(lead)) continue;
    return {
      lead,
      items: items.map((item) => ({ label: item.label, text: item.text.trim() })),
      after: tail,
    };
  }
  return null;
}

function asksRightBefore(lead: string): boolean {
  return ENDS_ASKING.test(lead) || (ENDS_INTRODUCING.test(lead) && ASKS.test(lead));
}

function splitTail(text: string, labels: ReadonlyArray<string>): [string, string] {
  const [own = "", ...rest] = text.split(/\n[ \t]*\n/);
  const restText = rest.join("\n\n");
  const sentences = own.trim().split(SENTENCE_END);
  const mention = sentences.findIndex(
    (sentence, index) => index > 0 && labels.some((label) => mentions(sentence, label)),
  );
  if (mention === -1) return [own, restText];
  return [
    sentences.slice(0, mention).join(" "),
    [sentences.slice(mention).join(" "), restText].filter((part) => part !== "").join("\n\n"),
  ];
}

function mentions(sentence: string, label: string): boolean {
  return new RegExp(`(?:^|[^A-Za-z0-9])${label}(?:$|[^A-Za-z0-9])`).test(sentence);
}

function lineItem(line: string): Item | null {
  const match = LINE_MARKER.exec(line);
  if (match === null) return null;
  const text = (match[3] ?? "").trim();
  if (text === "") return null;
  return { label: match[1] ?? match[2] ?? "", text };
}

function startsSequence(label: string): boolean {
  return label === "A" || label === "a" || label === "1";
}

function following(label: string): string {
  if (/^\d+$/.test(label)) return String(Number(label) + 1);
  return String.fromCharCode(label.charCodeAt(0) + 1);
}

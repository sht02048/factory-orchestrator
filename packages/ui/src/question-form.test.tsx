import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuestionForm } from "./index";
import type { QuestionFormLabels } from "./index";

const labels: QuestionFormLabels = {
  other: "Write my own",
  otherLabel: "My answer",
  otherPlaceholder: "Type an answer",
  answerLabel: "Answer",
  pick: "Pick one",
  empty: "Write an answer",
  note: "Sends right away",
  shortcut: "Cmd Enter sends",
  send: "Send",
  sending: "Sending",
  failed: "Could not send",
};

const send = () => Promise.resolve();

describe("QuestionForm(티켓 0116)", () => {
  it("질문 문단마다 p 를 두고 라디오 묶음 이름을 질문으로 잇는다", () => {
    const html = renderToString(
      <QuestionForm
        lead={["First line\nsecond line", "Which one?"]}
        choices={[
          { marker: "A", text: "Left", answer: "(A) Left" },
          { marker: "B", text: "Right", answer: "(B) Right" },
        ]}
        after={["I suggest B."]}
        labels={labels}
        onSend={send}
      />,
    );
    const leadId = /role="radiogroup" aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toMatch(
      new RegExp(
        `<div id="${leadId}"[^>]*><p[^>]*>First line\nsecond line</p><p[^>]*>Which one\\?</p></div>`,
      ),
    );
    expect(html).toMatch(
      /<span class="[^"]+"><span class="[^"]+">A<\/span> <span>Left<\/span><\/span>/,
    );
    expect(html).toContain(">Write my own<");
    expect(html.indexOf("I suggest B.")).toBeGreaterThan(html.indexOf("Write my own"));
    expect(html).toMatch(/<button[^>]*data-variant="primary"[^>]*>Send<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Send/);
    expect(html).toContain(">Pick one<");
  });

  it("선택지가 없으면 라디오 없이 이름 붙은 답 칸을 바로 보인다", () => {
    const html = renderToString(
      <QuestionForm lead={["Anything else?"]} choices={[]} labels={labels} onSend={send} />,
    );
    expect(html).not.toContain('type="radio"');
    expect(html).toContain("<textarea");
    expect(html).toContain(">Answer<");
    expect(html).toContain(">Cmd Enter sends<");
    const describedBy =
      /<textarea[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1]?.split(" ") ?? [];
    const leadId = /<div id="([^"]+)"[^>]*><p/.exec(html)?.[1];
    expect(describedBy[0]).toBe(leadId);
    expect(describedBy).toHaveLength(3);
  });

  it("ask 의 선택지는 글자 없이 그대로 보인다", () => {
    const html = renderToString(
      <QuestionForm
        lead={["Which cache?"]}
        choices={[{ marker: null, text: "SQLite (추천)", answer: "SQLite (추천)" }]}
        labels={labels}
        onSend={send}
      />,
    );
    expect(html).toMatch(/<input type="radio"[^>]*>\s*<span[^>]*>SQLite \(추천\)<\/span>/);
  });
});

import { describe, expect, it } from "vitest";
import { renderWithMessages } from "../testing/render";
import { runnerSetupMessages } from "./messages";
import { RunnerSetup, canOpenSharingSettings } from "./runner-setup";
import type { RunnerSetupActions } from "./runner-setup";

const pending: RunnerSetupActions = {
  thisMacStatus: () => new Promise(() => undefined),
  runThisMacStep: () => Promise.reject(new Error("unused")),
};

function render(primary = true): string {
  return renderWithMessages(
    <RunnerSetup
      actions={pending}
      manualForm={<form aria-label="manual-form" />}
      onRegistered={() => undefined}
      primary={primary}
    />,
    runnerSetupMessages,
  );
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ");

describe("러너 고르기 화면(0095)", () => {
  it("서버 맥 상태를 맨 위에서 읽고, 질문 줄 오른쪽에 범례를 한 번 보인다", () => {
    const html = render();
    const shown = text(html);
    expect(shown.indexOf("이 Ganger 서버가 도는 맥")).toBeLessThan(
      shown.indexOf("에이전트를 어느 맥에서 돌릴까요?"),
    );
    expect(shown).toContain("이 맥을 살펴보고 있어요");
    expect(html.match(/직접 해요<\/span>/g)?.length).toBe(1);
    expect(html.match(/Ganger가 해요<\/span>/g)?.length).toBe(1);
  });

  it("선택지 셋 중 이 맥이 골라져 있고, 고른 카드 안에만 단계 칩과 약 1분이 있다", () => {
    const html = render();
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/type="radio"[^>]*checked=""[^>]*value="thisMac"/);
    const chips = html.slice(html.indexOf('aria-label="할 일 순서"'));
    expect(html.match(/aria-label="할 일 순서"/g)).toHaveLength(1);
    expect(text(chips)).toContain("직접 해요: 원격 로그인 켜기");
    for (const step of ["키 등록", "Orca 서비스", "GitHub 정리", "확인"]) {
      expect(text(chips)).toContain(`Ganger가 해요: ${step}`);
    }
    expect(text(html)).toContain("약 1분");
    expect(text(html).match(/곧 지원해요/g)).toHaveLength(2);
  });

  it("직접 할 단계는 색이 아니라 보이는 글로도 직접 한다고 알린다", () => {
    const html = render();
    expect(html).toMatch(/<span class="[^"]+">직접 해요: 원격 로그인 켜기<\/span>/);
    expect(html).toMatch(/<span aria-hidden="true">키 등록<\/span>/);
  });

  it("단계 칩 목록의 자식은 모두 목록 항목이다", () => {
    const html = render();
    const list = html.slice(html.indexOf('aria-label="할 일 순서"'));
    const body = list.slice(list.indexOf(">") + 1, list.indexOf("</ol>"));
    expect(body.replace(/<li[^>]*>.*?<\/li>/g, "")).toBe("");
  });

  it("직접 입력하기는 접혀 있고 그 안에 지금 폼이 있다", () => {
    const html = render();
    expect(html).toMatch(/<details[^>]*><summary[^>]*>직접 입력하기\(ssh 설정을 이미 해 둔 경우\)/);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toContain('aria-label="manual-form"');
  });

  it("Ganger가 대신 해 주는 일, 러너 맥이 잠들면 문구는 두지 않는다", () => {
    const shown = text(render());
    expect(shown).not.toContain("대신 해 주는 일");
    expect(shown).not.toContain("잠들면");
  });

  it("계속 버튼은 화면의 주 버튼일 때만 노랗다", () => {
    expect(render(true)).toMatch(/data-variant="primary"[^>]*>이 방법으로 계속/);
    expect(render(false)).toMatch(/data-variant="secondary"[^>]*>이 방법으로 계속/);
  });
});

describe("공유 설정 열기 버튼", () => {
  it("이 맥에서 도는 데스크톱 앱에서만 연다", () => {
    const electron = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Electron/38.0.0 Safari/537.36";
    const chrome = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0 Safari/537.36";
    expect(canOpenSharingSettings(electron, "127.0.0.1")).toBe(true);
    expect(canOpenSharingSettings(electron, "localhost")).toBe(true);
    expect(canOpenSharingSettings(electron, "server.example.ts.net")).toBe(false);
    expect(canOpenSharingSettings(chrome, "127.0.0.1")).toBe(false);
  });
});

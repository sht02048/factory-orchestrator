import { describe, expect, it } from "vitest";
import { renderWithMessages } from "../testing/render";
import { runnerSetupMessages } from "./messages";
import { AppFlow } from "./app-flow";
import { CommandFlow } from "./command-flow";
import { remainingLabel } from "./enrollment";
import { RunnerSetup, canOpenSharingSettings } from "./runner-setup";
import type { RunnerSetupActions } from "./runner-setup";

const pending: RunnerSetupActions = {
  thisMacStatus: () => new Promise(() => undefined),
  runThisMacStep: () => Promise.reject(new Error("unused")),
  startEnrollment: () => new Promise(() => undefined),
  startAppEnrollment: () => new Promise(() => undefined),
  saveWebAddress: () => new Promise(() => undefined),
  enrollment: () => new Promise(() => undefined),
  cancelEnrollment: () => Promise.resolve(),
};

function render(primary = true, directOpen = false): string {
  return renderWithMessages(
    <RunnerSetup
      actions={pending}
      manualForm={<form aria-label="manual-form" />}
      direct={{
        open: directOpen,
        openHref: "/onboarding?step=3&direct=true",
        closeHref: "/onboarding?step=3",
        onChange: () => undefined,
      }}
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
    expect(html.match(/<input[^>]*value="thisMac"[^>]*>/)?.[0]).not.toContain("disabled");
    const chips = html.slice(html.indexOf('aria-label="할 일 순서"'));
    expect(html.match(/aria-label="할 일 순서"/g)).toHaveLength(1);
    expect(text(chips)).toContain("직접 해요: 원격 로그인 켜기");
    for (const step of ["키 등록", "Orca 서비스", "GitHub 정리", "확인"]) {
      expect(text(chips)).toContain(`Ganger가 해요: ${step}`);
    }
    expect(text(html)).toContain("약 1분");
  });

  it("세 선택지를 모두 고를 수 있고 곧 지원 꼬리표가 없다(0099)", () => {
    const html = render();
    for (const option of ["thisMac", "appMac", "commandMac"]) {
      expect(html.match(new RegExp(`<input[^>]*value="${option}"[^>]*>`))?.[0]).not.toContain(
        "disabled",
      );
    }
    const shown = text(html);
    expect(shown).not.toContain("곧 지원");
    expect(shown).toContain("다른 맥 · 그 맥에 Ganger 앱이 있어요");
    expect(shown).toContain("그 맥의 Ganger 앱에서 버튼 하나로 등록해요.");
    expect(shown).not.toContain("지금은 아래");
    expect(shown).not.toContain("직접 입력하기'로");
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

  it("고르기 화면에는 접는 칸 없이 계속 버튼 옆 링크로 직접 입력 화면을 연다", () => {
    const html = render();
    expect(html).not.toContain("<details");
    expect(html).not.toContain('aria-label="manual-form"');
    const shown = text(html);
    expect(shown.indexOf("이 방법으로 계속")).toBeLessThan(
      shown.indexOf("ssh 설정을 이미 해 뒀나요?"),
    );
    expect(html).toMatch(/<a href="\/onboarding\?step=3&amp;direct=true"[^>]*>주소 직접 입력하기/);
  });

  it("직접 입력 화면은 맥 고르기로 링크, 제목, 단계 칩, 지금 폼만 보인다", () => {
    const html = render(true, true);
    const shown = text(html);
    expect(html).toMatch(/<a href="\/onboarding\?step=3"[^>]*>.*맥 고르기로/);
    expect(shown).toContain("ssh로 닿는 맥을 직접 넣어요");
    expect(shown).toContain("주소만 넣으면 Ganger가 나머지를 확인해요");
    expect(html).toContain('aria-label="manual-form"');
    const chips = text(html.slice(html.indexOf('aria-label="할 일 순서"')));
    expect(chips).toContain("직접 해요: ssh 대상 넣기");
    for (const step of ["접속 확인", "Orca 찾기", "GitHub 확인"]) {
      expect(chips).toContain(`Ganger가 해요: ${step}`);
    }
    expect(shown).not.toContain("에이전트를 어느 맥에서 돌릴까요?");
    expect(shown).not.toContain("이 Ganger 서버가 도는 맥");
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

describe("명령으로 등록(0097)", () => {
  it("남은 시간을 분:초로 보인다", () => {
    expect(remainingLabel(10 * 60_000)).toBe("10:00");
    expect(remainingLabel(9 * 60_000 + 41_200)).toBe("9:42");
    expect(remainingLabel(999)).toBe("0:01");
    expect(remainingLabel(-5)).toBe("0:00");
  });

  it("명령을 받기 전에는 두 단계와 만드는 중 상태, 하는 일과 안 될 때 안내를 보이고, 새 명령 받기는 멈췄을 때만 둔다", () => {
    const html = renderWithMessages(
      <CommandFlow
        actions={pending}
        titleRef={{ current: null }}
        onBack={() => undefined}
        primary
      />,
      runnerSetupMessages,
    );
    const shown = text(html);
    expect(html).toContain('aria-label="다른 맥을 명령으로 등록해요"');
    expect(shown).toContain("러너로 쓸 맥에서 원격 로그인을 켜요");
    expect(shown).toContain("그 맥의 터미널에 붙여 넣어요");
    expect(shown).toContain("명령을 만들고 있어요");
    expect(html).toContain("<details");
    expect(shown).toContain("이 명령이 하는 일");
    expect(shown).toContain("관리자 암호를 묻지 않고, 비밀 값을 서버로 보내지 않아요.");
    expect(shown).toContain("명령이 안 되면");
    expect(text(html)).not.toContain("새 명령 받기");
  });
});

describe("Ganger 앱으로 등록(0099)", () => {
  it("요청을 만드는 동안 그 맥에서 할 두 단계, 앱이 하는 일과 뜨지 않을 때 안내를 보이고, 다시 요청하기는 멈췄을 때만 둔다", () => {
    const html = renderWithMessages(
      <AppFlow actions={pending} titleRef={{ current: null }} onBack={() => undefined} primary />,
      runnerSetupMessages,
    );
    const shown = text(html);
    expect(html).toContain('aria-label="다른 맥의 Ganger 앱으로 등록해요"');
    expect(shown).toContain("러너로 쓸 맥에서 원격 로그인을 켜요");
    expect(shown).toContain("그 맥의 Ganger 앱에서 등록을 눌러요");
    expect(shown).toContain("“이 맥을 러너로 등록할까요?”가 떠요");
    expect(shown).toContain("요청을 만들고 있어요");
    expect(shown).toContain("그 맥의 앱이 하는 일");
    expect(shown).toContain("앱에 요청이 뜨지 않으면");
    expect(shown).not.toContain("명령 복사");
    expect(shown).not.toContain("다시 요청하기");
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

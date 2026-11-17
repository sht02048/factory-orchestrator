import tickets from "../../messages/ko/tickets.json" with { type: "json" };

// Tickets 화면의 메시지 파일. 라우트가 ScreenMessages 로 싣는다(i18n.tsx).
declare module "../i18n" {
  interface AppMessages {
    tickets: typeof tickets;
  }
}

export const ticketsMessages = { tickets };

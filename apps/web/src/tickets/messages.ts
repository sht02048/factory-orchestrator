import tickets from "../../messages/ko/tickets.json" with { type: "json" };

declare module "../i18n" {
  interface AppMessages {
    tickets: typeof tickets;
  }
}

export const ticketsMessages = { tickets };

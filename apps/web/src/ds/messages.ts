import ds from "../../messages/ko/ds.json" with { type: "json" };

declare module "../i18n" {
  interface AppMessages {
    ds: typeof ds;
  }
}

export const dsMessages = { ds };

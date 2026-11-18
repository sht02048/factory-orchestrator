import placeholder from "../../messages/ko/placeholder.json" with { type: "json" };

declare module "../i18n" {
  interface AppMessages {
    placeholder: typeof placeholder;
  }
}

export const placeholderMessages = { placeholder };

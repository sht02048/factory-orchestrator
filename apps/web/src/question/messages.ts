import question from "../../messages/ko/question.json" with { type: "json" };

declare module "../i18n" {
  interface AppMessages {
    question: typeof question;
  }
}

export const questionMessages = { question };

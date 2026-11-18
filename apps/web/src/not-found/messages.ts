import notFound from "../../messages/ko/notFound.json" with { type: "json" };

declare module "../i18n" {
  interface AppMessages {
    notFound: typeof notFound;
  }
}

export const notFoundMessages = { notFound };

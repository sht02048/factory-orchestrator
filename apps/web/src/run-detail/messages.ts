import run from "../../messages/ko/run.json" with { type: "json" };
import { questionMessages } from "../question/messages";

declare module "../i18n" {
  interface AppMessages {
    run: typeof run;
  }
}

export const runMessages = { run, ...questionMessages };

import { createServerFn } from "@tanstack/react-start";
import {
  createFirstWorkspace,
  firstWorkspaceInput,
  isOnboardingComplete,
} from "../onboarding/load";
import { getSecretBox } from "./adapters";
import { getDatabase } from "./database";

/*
 * 온보딩(0026)의 server function. 입력 폼과 연결 확인은 settings-functions 의 것을 그대로 쓴다.
 */

/** 온보딩을 마쳤는지. 루트 라우트가 화면에 들어갈 때마다 부른다. DB 만 읽는다 */
export const getOnboardingComplete = createServerFn({ method: "GET" }).handler(() =>
  isOnboardingComplete(getDatabase(), getSecretBox()),
);

export const createWorkspace = createServerFn({ method: "POST" })
  .validator(firstWorkspaceInput)
  .handler(({ data }) => createFirstWorkspace(getDatabase(), data, new Date()));

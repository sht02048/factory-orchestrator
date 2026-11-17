import type { Brand } from "@factory/core";

/** 오케스트레이터가 만든 Workspace 하나의 ID */
export type WorkspaceId = Brand<string, "WorkspaceId">;
/** 오케스트레이터에 등록한 코드 호스트 연결 하나의 ID */
export type CodeHostConnectionId = Brand<string, "CodeHostConnectionId">;

function isNonEmpty<B extends string>(value: string): value is Brand<string, B> {
  return value.length > 0;
}

function brand<B extends string>(kind: B, value: string): Brand<string, B> {
  if (!isNonEmpty<B>(value)) {
    throw new TypeError(`${kind}는 빈 문자열일 수 없다`);
  }
  return value;
}

export const toWorkspaceId = (value: string): WorkspaceId => brand("WorkspaceId", value);
export const toCodeHostConnectionId = (value: string): CodeHostConnectionId =>
  brand("CodeHostConnectionId", value);

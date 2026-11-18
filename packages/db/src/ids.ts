import type { Brand } from "@ganger/core";

export type WorkspaceId = Brand<string, "WorkspaceId">;
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

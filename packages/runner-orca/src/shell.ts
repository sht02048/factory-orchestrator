/**
 * 러너에 보낼 명령을 원격 셸 문자열로 바꾸는 한 곳(CODING_STANDARDS 「ssh로 보내는 명령은 인자 배열로
 * 만들고 한 곳에서 이스케이프한다」). 원격 명령 문자열은 원격 셸(zsh, bash)이 한 번 더 해석하므로 인자마다
 * POSIX 작은따옴표로 감싼다. 작은따옴표 안에서는 줄바꿈·큰따옴표·`$`·백틱·백슬래시·`!`가 모두 글자 그대로다.
 * 작은따옴표 자체는 `'\''`로 바꾼다(research 0004 5절, 0003 6절).
 */

/**
 * 원격 명령 문자열의 상한(바이트). ssh는 명령 문자열 전체가 약 256 KiB를 넘으면 연결을 끊었다. 여유를 두어
 * 200 KiB에서 거절한다(research 0004 5절).
 */
export const MAX_REMOTE_COMMAND_BYTES = 200 * 1024;

const SAFE_ARG = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** 인자 하나를 원격 셸이 글자 그대로 받도록 인용한다. */
export function quoteArg(arg: string): string {
  if (SAFE_ARG.test(arg)) return arg;
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

/** 원격 명령 문자열이 상한을 넘음 */
export class RemoteCommandTooLongError extends Error {
  readonly bytes: number;

  constructor(bytes: number) {
    super(`remote command is ${bytes} bytes, over the ${MAX_REMOTE_COMMAND_BYTES}-byte limit`);
    this.name = "RemoteCommandTooLongError";
    this.bytes = bytes;
  }
}

/** 인자 배열을 원격 셸에 넘길 명령 문자열로 만든다. 상한을 넘으면 RemoteCommandTooLongError를 던진다. */
export function toRemoteCommand(argv: ReadonlyArray<string>): string {
  if (argv.length === 0) throw new TypeError("remote command needs at least one argument");
  const command = argv.map(quoteArg).join(" ");
  const bytes = Buffer.byteLength(command, "utf8");
  if (bytes > MAX_REMOTE_COMMAND_BYTES) throw new RemoteCommandTooLongError(bytes);
  return command;
}

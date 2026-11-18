export const MAX_REMOTE_COMMAND_BYTES = 200 * 1024;

const SAFE_ARG = /^[A-Za-z0-9_@%+:,./-]+$/;

export function quoteArg(arg: string): string {
  if (SAFE_ARG.test(arg)) return arg;
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

export class RemoteCommandTooLongError extends Error {
  readonly bytes: number;

  constructor(bytes: number) {
    super(`remote command is ${bytes} bytes, over the ${MAX_REMOTE_COMMAND_BYTES}-byte limit`);
    this.name = "RemoteCommandTooLongError";
    this.bytes = bytes;
  }
}

export function toRemoteCommand(argv: ReadonlyArray<string>): string {
  if (argv.length === 0) throw new TypeError("remote command needs at least one argument");
  const command = argv.map(quoteArg).join(" ");
  const bytes = Buffer.byteLength(command, "utf8");
  if (bytes > MAX_REMOTE_COMMAND_BYTES) throw new RemoteCommandTooLongError(bytes);
  return command;
}

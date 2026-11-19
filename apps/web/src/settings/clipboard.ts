export interface TextClipboard {
  writeText(text: string): Promise<void>;
}

export async function copyText(
  text: string,
  clipboard: TextClipboard | undefined,
): Promise<boolean> {
  if (clipboard === undefined) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function browserClipboard(): TextClipboard | undefined {
  return "clipboard" in navigator ? navigator.clipboard : undefined;
}

const SHARING_SETTINGS = "x-apple.systempreferences:com.apple.preferences.sharing";

export function opensOutsideApp(url: string): boolean {
  return /^https?:/.test(url) || url.startsWith(SHARING_SETTINGS);
}

const SHARING_SETTINGS = /^x-apple\.systempreferences:com\.apple\.preferences\.sharing(\?\w+)?$/;

export function opensOutsideApp(url: string): boolean {
  return /^https?:/.test(url) || SHARING_SETTINGS.test(url);
}

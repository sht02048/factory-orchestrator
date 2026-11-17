/** 화면에 링크로 거는 PR 주소. 코드 호스트가 준 값이라 http(s) 주소만 건다(javascript: 등을 막는다). */
export function isWebUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "https:" || protocol === "http:";
}

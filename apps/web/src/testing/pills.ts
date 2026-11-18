/*
 * 렌더한 HTML 에서 상태 알약(StatusPill)을 읽는다. 알약은 data-status 와 점(aria-hidden) 뒤에 이름을 그린다.
 */

export interface RenderedPill {
  status: string;
  label: string;
}

const PILL = /data-status="([^"]+)"[^>]*><span aria-hidden="true"[^>]*><\/span>([^<]*)<\/span>/g;

export function pillsOf(html: string): RenderedPill[] {
  return [...html.matchAll(PILL)].map((m) => ({ status: m[1] ?? "", label: m[2] ?? "" }));
}

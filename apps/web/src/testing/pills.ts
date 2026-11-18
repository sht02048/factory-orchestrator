export interface RenderedPill {
  status: string;
  label: string;
}

const PILL = /data-status="([^"]+)"[^>]*><span aria-hidden="true"[^>]*><\/span>([^<]*)<\/span>/g;

export function pillsOf(html: string): RenderedPill[] {
  return [...html.matchAll(PILL)].map((m) => ({ status: m[1] ?? "", label: m[2] ?? "" }));
}

import { useState } from "react";

export interface FirstDraw {
  ws: string | undefined;
  catchingUp: boolean;
  generation: number;
}

export function nextFirstDraw(
  draw: FirstDraw,
  ws: string | undefined,
  isFetching: boolean,
): FirstDraw {
  if (draw.ws !== ws) return { ws, catchingUp: isFetching, generation: draw.generation + 1 };
  if (draw.catchingUp && !isFetching) {
    return { ws, catchingUp: false, generation: draw.generation + 1 };
  }
  return draw;
}

export function useFirstDrawKey(ws: string | undefined, isFetching: boolean): string {
  const [draw, setDraw] = useState<FirstDraw>({ ws, catchingUp: isFetching, generation: 0 });
  const next = nextFirstDraw(draw, ws, isFetching);
  if (next !== draw) setDraw(next);
  return String(next.generation);
}

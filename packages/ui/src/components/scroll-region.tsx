import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { focusStyles } from "./focus";

export interface ScrollRegionProps {
  label: string;
  minWidth?: string;
  active?: boolean;
  children: ReactNode;
}

export function ScrollRegion({ label, minWidth, active = true, children }: ScrollRegionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const overflowing = useOverflowing(ref) && active;
  return (
    <div
      ref={ref}
      {...(overflowing ? { role: "region", "aria-label": label, tabIndex: 0 } : {})}
      {...stylex.props(active && styles.scroller, focusStyles.ringInset)}
    >
      <div {...(minWidth === undefined ? {} : { style: { minWidth } })}>{children}</div>
    </div>
  );
}

function useOverflowing(ref: RefObject<HTMLDivElement | null>): boolean {
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => setOverflowing(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild !== null) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [ref]);
  return overflowing;
}

const styles = stylex.create({
  scroller: { overflowX: "auto" },
});

import * as stylex from "@stylexjs/stylex";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { size } from "../tokens.stylex";
import { windowRegion } from "../window-frame";

const TitleBarHiddenContext = createContext(false);

export interface WindowChromeProps {
  titleBarHidden: boolean;
  children: ReactNode;
}

export function WindowChrome({ titleBarHidden, children }: WindowChromeProps) {
  return (
    <TitleBarHiddenContext.Provider value={titleBarHidden}>
      {children}
    </TitleBarHiddenContext.Provider>
  );
}

export function useTitleBarHidden(): boolean {
  return useContext(TitleBarHiddenContext);
}

export function WindowDragFrame({ children }: { children: ReactNode }) {
  const titleBarHidden = useTitleBarHidden();
  if (!titleBarHidden) return children;
  return (
    <div {...stylex.props(styles.frame)}>
      <div aria-hidden="true" {...windowRegion("drag")} />
      <div {...stylex.props(styles.body)}>{children}</div>
    </div>
  );
}

const styles = stylex.create({
  frame: {
    display: "grid",
    gridTemplateRows: `${size.titleBar} minmax(0, 1fr)`,
    height: "100dvh",
  },
  body: { position: "relative", minWidth: 0, minHeight: 0, overflow: "auto" },
});

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

export function WindowDragStrip() {
  const titleBarHidden = useTitleBarHidden();
  if (!titleBarHidden) return null;
  return <div aria-hidden="true" {...windowRegion("drag")} {...stylex.props(styles.strip)} />;
}

const styles = stylex.create({
  strip: {
    position: "fixed",
    top: 0,
    insetInline: 0,
    height: size.titleBar,
  },
});

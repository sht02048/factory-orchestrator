import type { ReactNode } from "react";

// 레일 메뉴 아이콘(시안 B). 색은 currentColor 를 따른다.

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const navIcons = {
  home: (
    <Icon>
      <path d="M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5h-3v-4H6v4H3a.5.5 0 0 1-.5-.5Z" />
    </Icon>
  ),
  tickets: (
    <Icon>
      <path d="M5.5 4h7M5.5 8h7M5.5 12h7" />
      <circle cx="2.75" cy="4" r=".75" fill="currentColor" stroke="none" />
      <circle cx="2.75" cy="8" r=".75" fill="currentColor" stroke="none" />
      <circle cx="2.75" cy="12" r=".75" fill="currentColor" stroke="none" />
    </Icon>
  ),
  runs: (
    <Icon>
      <path d="M1.5 8h3l1.75-4.5 3.5 9L11.5 8h3" />
    </Icon>
  ),
  runners: (
    <Icon>
      <rect x="2" y="2.5" width="12" height="4.5" rx="1.25" />
      <rect x="2" y="9" width="12" height="4.5" rx="1.25" />
      <path d="M4.5 4.75h.01M4.5 11.25h.01" strokeWidth="2" />
    </Icon>
  ),
  stats: (
    <Icon>
      <path d="M2.5 13.5h11M4.5 11V8M8 11V4M11.5 11V6.5" />
    </Icon>
  ),
  settings: (
    <Icon>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.42 3.58l-1.06 1.06M4.64 11.36l-1.06 1.06M12.42 12.42l-1.06-1.06M4.64 4.64 3.58 3.58" />
      <circle cx="8" cy="8" r="4.25" />
    </Icon>
  ),
} as const;

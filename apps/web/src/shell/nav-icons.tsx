import type { ReactNode } from "react";

// 사이드바 내비 아이콘(시안 B). 색은 currentColor 를 따른다.

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
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
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="6" cy="11.5" r="1.5" />
    </Icon>
  ),
} as const;

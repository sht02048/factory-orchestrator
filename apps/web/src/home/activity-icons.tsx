import type { ReactNode } from "react";
import type { ActivityEvent } from "./model";

// "지금 일어나는 일" 사건 아이콘(시안 B). 색은 currentColor 를 따른다. 상태 색은 알약만 쓴다(ADR 0010 4·5번).

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
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

const pullRequest = (
  <Icon>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="12.5" r="1.5" />
    <path d="M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7.5M9 3l-1.5 1.5L9 6" />
  </Icon>
);

export const activityIcons: Record<ActivityEvent["kind"], ReactNode> = {
  started: (
    <Icon>
      <path d="M5 3.5v9l7-4.5Z" />
    </Icon>
  ),
  question: (
    <Icon>
      <path d="M2.5 7.5a5.5 5 0 1 1 2.6 4.3L2.5 13l.8-2.6a4.8 4.8 0 0 1-.8-2.9Z" />
    </Icon>
  ),
  permission: (
    <Icon>
      <rect x="3" y="7" width="10" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </Icon>
  ),
  disconnected: (
    <Icon>
      <path d="M6.5 9.5 4.8 11.2a2 2 0 0 1-2.8-2.8L3.7 6.7M9.5 6.5l1.7-1.7a2 2 0 0 1 2.8 2.8l-1.7 1.7M2.5 2.5l11 11" />
    </Icon>
  ),
  ended: (
    <Icon>
      <path d="m3.5 8.5 3 3 6-7" />
    </Icon>
  ),
  "later-pr": pullRequest,
};

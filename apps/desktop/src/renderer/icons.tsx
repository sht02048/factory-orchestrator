import type { ReactNode } from "react";

function Icon({ size, stroke, children }: { size: number; stroke: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function LaptopIcon() {
  return (
    <Icon size={28} stroke={1.6}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </Icon>
  );
}

export function ServerIcon({ size = 28 }: { size?: number }) {
  return (
    <Icon size={size} stroke={1.7}>
      <rect x="3" y="3" width="18" height="7" rx="1.5" />
      <rect x="3" y="14" width="18" height="7" rx="1.5" />
      <path d="M7 6.5h.01M7 17.5h.01" />
    </Icon>
  );
}

export function ChevronLeftIcon() {
  return (
    <Icon size={16} stroke={2}>
      <path d="M15 18l-6-6 6-6" />
    </Icon>
  );
}

export function RefreshIcon() {
  return (
    <Icon size={18} stroke={2}>
      <path d="M21 12a9 9 0 11-2.6-6.4" />
      <path d="M21 4v5h-5" />
    </Icon>
  );
}

export function AlertIcon({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size} stroke={2}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4M12 16h.01" />
    </Icon>
  );
}

export function NoSignalIcon() {
  return (
    <Icon size={26} stroke={1.8}>
      <path d="M2 2l20 20" />
      <path d="M8.5 16.4a5 5 0 017 0" />
      <path d="M5 12.9a10 10 0 015.2-2.8M19 12.9a10 10 0 00-2.4-1.7" />
      <path d="M12 20h.01" />
    </Icon>
  );
}

export function PauseIcon() {
  return (
    <Icon size={26} stroke={1.8}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9v6M14 9v6" />
    </Icon>
  );
}

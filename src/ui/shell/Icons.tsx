/** PulseForge icon set — original 24×24 line icons (stroke follows currentColor). */
import type { SVGProps } from "react";

const paths: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  sparkles: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8zM5 15l.6 1.6L7.2 17.2l-1.6.6L5 19.4l-.6-1.6L2.8 17.2l1.6-.6z",
  pads: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  keys: "M3 5h18v14H3zM8 5v9M13 5v9M18 5v9M8 14v5M13 14v5M18 14v5M6.5 5v6h3V5M11.5 5v6h3V5M16.5 5v6h3V5",
  song: "M3 6h8M3 12h13M3 18h6M14 6h7M19 12h2M12 18h9",
  mixer: "M6 3v18M12 3v18M18 3v18M4 15h4M10 8h4M16 13h4",
  mic: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3M8 21h8",
  library: "M4 19V5a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM10 15.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM10 15.5V9l5-1v5.5",
  wave: "M2 12h2l2-6 3 12 3-15 3 15 3-9 2 3h2",
  knob: "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4M5 5l1.5 1.5M19 5l-1.5 1.5M12 2v1",
  chat: "M4 5h16v11H9l-5 4z M8 9.5h8M8 12.5h5",
  flask: "M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7 15h10",
  plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z",
  play: "M7 4.5v15l12-7.5z",
  pause: "M7 4h3.5v16H7zM13.5 4H17v16h-3.5z",
  stop: "M6 6h12v12H6z",
  record: "M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z",
  loop: "M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4",
  rewind: "M11 18V6l-8 6zM21 18V6l-8 6z",
  metronome: "M9 3h6l3 18H6zM12 17l5-9M8 14h8",
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h2",
  save: "M5 3h11l3 3v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 3v5h7V3M8 21v-7h8v7",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  export: "M12 3v12M7 8l5-5 5 5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.5",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  chevron: "M9 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6",
  wand: "M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M12.2 6.2 11 5M3 21l9-9",
  dice: "M4 4h16v16H4zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01",
  seedling: "M12 21v-8M12 13c0-4 3-7 8-7 0 5-3 7-8 7zM12 13c0-3-2.5-5.5-7-5.5 0 4 2.5 5.5 7 5.5z",
  rocket: "M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 13l2 2M14.5 4.5C17 2 21 3 21 3s1 4-1.5 6.5L13 16l-5-5zM15 9h.01",
  crown: "M3 8l4 4 5-7 5 7 4-4-2 11H5z",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  check: "M5 12.5l4.5 4.5L19 7",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  terminal: "M4 4h16v16H4zM8 9l3 3-3 3M13 15h3",
  key: "M15 7a4 4 0 1 1-3.5 5.9L4 20H2v-2l1-1v-2h2v-2l2.6-2.6A4 4 0 0 1 15 7zM16 8h.01",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  layers: "M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 18l10 5 10-5",
  shuffle: "M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4h6v3",
  copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  menu: "M4 6h16M4 12h16M4 18h16",
  panelLeft: "M3 4h18v16H3zM9 4v16",
  panelRight: "M3 4h18v16H3zM15 4v16",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3",
  star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
  headphones: "M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z",
  drum: "M12 9c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 6v11c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 11c0 1.7 3.6 3 8 3s8-1.3 8-3M19 2 15 9M5 2l4 7",
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18, strokeWidth = 1.8, ...rest }: { name: IconName; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path d={paths[name]} />
    </svg>
  );
}

/** The PulseForge mark: an anvil-shaped pulse — original artwork. */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="pf-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--ember)" />
          <stop offset="1" stopColor="var(--violet)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#pf-mark)" />
      <path d="M5 18h5l2.5-7 3.5 12 3-15 2.5 10H27" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

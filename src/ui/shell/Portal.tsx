/**
 * Render menus and dialogs at the document root. A popup rendered inside the top bar, a scroll
 * area or any `overflow: hidden` box gets clipped by it (and `transform`, `filter` or
 * `backdrop-filter` on an ancestor even re-anchors `position: fixed`), so overlays live in <body>.
 */
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

/** Place a `width × height` popup under (or, if it won't fit, above) an anchor, inside the window. */
export function placeMenu(anchor: DOMRect, width: number, height: number, gap = 6): { left: number; top: number; maxHeight: number } {
  const vw = window.innerWidth, vh = window.innerHeight, pad = 8;
  const left = Math.max(pad, Math.min(anchor.left, vw - width - pad));
  const below = vh - anchor.bottom - gap - pad;
  const above = anchor.top - gap - pad;
  if (below >= Math.min(height, 240) || below >= above) return { left, top: anchor.bottom + gap, maxHeight: Math.max(120, below) };
  const h = Math.min(height, above);
  return { left, top: anchor.top - gap - h, maxHeight: above };
}

/** Clamp a point-anchored popup (context menus) so it stays fully on screen. */
export function clampToWindow(x: number, y: number, width: number, height: number): { left: number; top: number } {
  const pad = 8;
  return { left: Math.max(pad, Math.min(x, window.innerWidth - width - pad)), top: Math.max(pad, Math.min(y, window.innerHeight - height - pad)) };
}

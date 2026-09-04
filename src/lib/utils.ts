// Copyright (c) 2026. Licensed under AGPLv3.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * crypto.randomUUID() with a fallback.
 *
 * randomUUID needs a secure context AND Chrome 92+ / iOS Safari 15.4+. Some
 * Android WebViews in the wild are older than that (emulators, cloned-app
 * spaces, devices that never update System WebView), where calling it throws
 * `TypeError: crypto.randomUUID is not a function` — see Sentry OPENKEEP-3,
 * which blocked note creation entirely for those users.
 *
 * Falls back to getRandomValues, then to Math.random as a last resort. The
 * final fallback is NOT cryptographically strong — these IDs are note/item
 * identifiers only, never keys or tokens. Do not reuse this for anything
 * security-sensitive.
 */
export function safeRandomUUID(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;

  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  // RFC 4122 v4: set version and variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

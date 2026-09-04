// Copyright (c) 2026. Licensed under AGPLv3.

/**
 * Per-note background colours.
 *
 * A note stores the palette *id* (e.g. "sage"), never a colour value. That
 * buys two things:
 *   - retuning a swatch here applies retroactively to every existing note, and
 *   - one id can carry a light AND a dark value, which a stored hex cannot.
 *
 * Values are complete CSS colours, used as-is (not wrapped in hsl()), so a
 * swatch can be retuned here by pasting a hex straight from the design.
 */

export const DEFAULT_NOTE_COLOR = "default";

export interface NoteColor {
  id: string;
  label: string;
  /** CSS colour for light mode. Empty on the default (no tint). */
  light: string;
  /** CSS colour for dark mode. Empty on the default (no tint). */
  dark: string;
}

export const NOTE_COLORS: NoteColor[] = [
  { id: DEFAULT_NOTE_COLOR, label: "Default", light: "", dark: "" },
  { id: "coral", label: "Coral", light: "#edb2a8", dark: "#6c202c" },
  { id: "peach", label: "Peach", light: "#e5a277", dark: "#602e17" },
  { id: "sand", label: "Sand", light: "#fdf7bb", dark: "#744c0a" },
  { id: "mint", label: "Mint", light: "#e6f5d5", dark: "#314c3c" },
  { id: "sage", label: "Sage", light: "#bddcd4", dark: "#2e605e" },
  { id: "fog", label: "Fog", light: "#d7e4ed", dark: "#386276" },
  { id: "storm", label: "Storm", light: "#b5cbdb", dark: "#2f4254" },
  { id: "dusk", label: "Dusk", light: "#cfc0da", dark: "#433059" },
  { id: "blossom", label: "Blossom", light: "#f2e2dd", dark: "#643c4e" },
  { id: "clay", label: "Clay", light: "#e8e3d5", dark: "#4a443a" },
  { id: "chalk", label: "Chalk", light: "#efeff1", dark: "#232427" },
];

const COLOR_BY_ID = new Map(NOTE_COLORS.map((c) => [c.id, c]));

/**
 * An id is "tinted" only if we still recognise it and it carries values. An
 * unknown id -- a swatch retired in a later release, or a corrupt row -- falls
 * back to the default rather than rendering a transparent card.
 */
export const isNoteTinted = (id?: string): boolean => {
  if (!id || id === DEFAULT_NOTE_COLOR) return false;
  const color = COLOR_BY_ID.get(id);
  return !!color && color.light !== "";
};

export const getNoteColor = (id?: string): NoteColor =>
  (id && COLOR_BY_ID.get(id)) || COLOR_BY_ID.get(DEFAULT_NOTE_COLOR)!;

/**
 * Normalise for storage: anything we don't recognise becomes undefined so the
 * column never accumulates junk ids.
 */
export const normalizeNoteColor = (id?: string): string | undefined =>
  isNoteTinted(id) ? id : undefined;

/**
 * Both theme values as CSS custom properties. CSS picks which one applies (see
 * the .note-tinted rules in globals.css) because ThemeProvider only exposes
 * "system" and never the resolved theme -- so JS cannot reliably decide here.
 */
export const getNoteTintVars = (id?: string): Record<string, string> | undefined => {
  if (!isNoteTinted(id)) return undefined;
  const color = getNoteColor(id);
  return { "--note-tint": color.light, "--note-tint-dark": color.dark };
};

// Copyright (c) 2026. Licensed under AGPLv3.

/**
 * Per-note background colours.
 *
 * A note stores the palette *id* (e.g. "sage"), never a colour value. That
 * buys two things:
 *   - retuning a swatch here applies retroactively to every existing note, and
 *   - one id can carry a light AND a dark value, which a stored hex cannot.
 *
 * The actual colour values live in globals.css (--note-<id> and
 * --note-<id>-dark) alongside the rest of the palette; retune a swatch there.
 */

export const DEFAULT_NOTE_COLOR = "default";

export interface NoteColor {
  id: string;
  label: string;
  /** CSS colour for light mode (a var() into globals.css). Empty on the default (no tint). */
  light: string;
  /** CSS colour for dark mode (a var() into globals.css). Empty on the default (no tint). */
  dark: string;
}

export const NOTE_COLORS: NoteColor[] = [
  { id: DEFAULT_NOTE_COLOR, label: "Default", light: "", dark: "" },
  { id: "coral", label: "Coral", light: "var(--note-coral)", dark: "var(--note-coral-dark)" },
  { id: "peach", label: "Peach", light: "var(--note-peach)", dark: "var(--note-peach-dark)" },
  { id: "sand", label: "Sand", light: "var(--note-sand)", dark: "var(--note-sand-dark)" },
  { id: "mint", label: "Mint", light: "var(--note-mint)", dark: "var(--note-mint-dark)" },
  { id: "sage", label: "Sage", light: "var(--note-sage)", dark: "var(--note-sage-dark)" },
  { id: "fog", label: "Fog", light: "var(--note-fog)", dark: "var(--note-fog-dark)" },
  { id: "storm", label: "Storm", light: "var(--note-storm)", dark: "var(--note-storm-dark)" },
  { id: "dusk", label: "Dusk", light: "var(--note-dusk)", dark: "var(--note-dusk-dark)" },
  { id: "blossom", label: "Blossom", light: "var(--note-blossom)", dark: "var(--note-blossom-dark)" },
  { id: "clay", label: "Clay", light: "var(--note-clay)", dark: "var(--note-clay-dark)" },
  { id: "chalk", label: "Chalk", light: "var(--note-chalk)", dark: "var(--note-chalk-dark)" },
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

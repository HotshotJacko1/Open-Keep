// Copyright (c) 2026. Licensed under AGPLv3.

// Letters of the scripts written right to left: Hebrew, Arabic (also used for
// Persian and Urdu), Syriac, Thaana, N'Ko and a few rarer ones.
const RTL_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}]/u;
const LETTER = /\p{L}/u;

/**
 * Which way a piece of note text reads, decided the way the browser decides
 * dir="auto": by its first letter. Digits and punctuation don't count, so
 * "2 لیتر شیر" is right to left. Text with no letters is left to right.
 *
 * Used where a whole row has to be mirrored (a checklist item's checkbox goes
 * on the right), which the CSS in globals.css (.auto-dir) can't do on its own.
 */
export function getTextDirection(text: string): "ltr" | "rtl" {
  const first = LETTER.exec(text)?.[0];
  return first !== undefined && RTL_LETTER.test(first) ? "rtl" : "ltr";
}

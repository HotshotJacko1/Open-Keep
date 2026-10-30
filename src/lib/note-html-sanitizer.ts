// Copyright (c) 2026. Licensed under AGPLv3.
import DOMPurify from "dompurify";

/**
 * The one sanitiser for note HTML, used when a card renders a note and when an
 * AI tool or an imported file stores one (C2-33).
 *
 * DOMPurify's defaults keep <img>, srcset, <video poster> and <style>, so a
 * note written over the MCP bridge could make the app fetch a URL the moment
 * its card renders (and, with read access, put other notes' text in that URL),
 * or restyle the whole app. Notes only ever need what the TipTap editor emits
 * (StarterKit plus Link), so everything else goes. `class` goes too: the
 * editor re-adds its link class on load, and the cards style links themselves.
 *
 * Never call a bare DOMPurify.sanitize() on note HTML; use this.
 */
const NOTE_HTML_CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "div", "span",
    "strong", "b", "em", "i", "u", "s", "strike", "del", "mark", "sub", "sup",
    "code", "pre", "blockquote", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "a",
  ],
  ALLOWED_ATTR: ["href", "target", "rel", "dir"],
  ALLOW_DATA_ATTR: false,
};

export const sanitizeNoteHtml = (html: string): string =>
  DOMPurify.sanitize(html, NOTE_HTML_CONFIG);

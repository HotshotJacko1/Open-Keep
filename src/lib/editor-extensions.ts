// Copyright (c) 2026. Licensed under AGPLv3.
//
// Shared TipTap extensions used by both NoteEditor and InlineNoteCreator.
// These live here rather than in either component because registering two
// separately-created Link extensions produces "[tiptap warn]: Duplicate
// extension names found: ['link']" and a RangeError (autolink plugin key
// collision) under StrictMode's double-render in dev. See Sentry OPENKEEP-H.
import { Extension } from "@tiptap/react";
import Link from "@tiptap/extension-link";

// Make Enter insert a line break (<br>) instead of a new paragraph
export const HardBreakOnEnter = Extension.create({
  name: "hardBreakOnEnter",
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.setHardBreak(),
    };
  },
});

// By default in TipTap, Link's inclusive() returns this.options.autolink (true),
// which means typing immediately after a link causes new text to be swallowed
// inside the link mark. Setting inclusive: false ensures newly typed text
// remains plain text.
export const CustomLink = Link.extend({
  inclusive: false,
});

// Shared config for the link extension, so both editors behave identically.
export const LINK_OPTIONS = {
  openOnClick: true,
  autolink: true,
  linkOnPaste: true,
  HTMLAttributes: {
    class: "underline text-inherit hover:text-blue-500 cursor-pointer",
  },
} as const;

package com.jackbarkerapps.openkeep

/**
 * Single source of truth for the checklist markdown the note editor writes
 * (`"${indent}- [x] text"`, see the checklist sync effect in NoteEditor.tsx).
 *
 * Both widgets used to carry their own copy of this parsing and it drifted:
 * SingleNoteWidget matched only a lowercase `x` via `startsWith`, while
 * NoteCollectionWidget used an anchored regex accepting `X` too — so an imported
 * `- [X]` rendered as a checkbox in one widget and plain text in the other. Its
 * toggle was worse: `line.replace("- [ ]", "- [x]")` flips *every* occurrence on
 * the line, so an item whose own text mentions the marker got mangled.
 *
 * Anything that reads or writes a checklist line goes through here.
 */
internal object ChecklistMarkdown {

    // Indent is captured so toggling round-trips nested items unchanged.
    private val ITEM = Regex("""^(\s*)-\s\[([ xX])\]\s?(.*)$""")

    data class Item(val indent: String, val isChecked: Boolean, val text: String)

    /** Parses one line, or null if it is not a checklist item. */
    fun parse(line: String): Item? {
        val m = ITEM.matchEntire(line) ?: return null
        return Item(
            indent = m.groupValues[1],
            isChecked = m.groupValues[2].equals("x", ignoreCase = true),
            text = m.groupValues[3]
        )
    }

    /** Returns the line with its marker flipped, or null if it is not a checklist item. */
    fun toggle(line: String): String? {
        val item = parse(line) ?: return null
        return "${item.indent}- [${if (item.isChecked) " " else "x"}] ${item.text}"
    }
}

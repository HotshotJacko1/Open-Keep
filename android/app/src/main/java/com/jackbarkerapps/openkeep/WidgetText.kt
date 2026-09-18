package com.jackbarkerapps.openkeep

import com.jackbarkerapps.openkeep.data.NoteEntity

/**
 * Turns a note's raw `content` column into plain text for widgets and the widget
 * configure screens.
 *
 * `content` holds one of two formats (see NoteEditor.tsx):
 *  - list notes: checklist markdown, one `"${indent}- [x] text"` item per line
 *  - text notes: the editor's HTML (`<p>...</p><p>...</p>`, usually on one line)
 *
 * Displaying either verbatim leaks `<p>` tags or `- [ ]` markers onto the home
 * screen. Checklist *parsing* lives in [ChecklistMarkdown]; this is only for
 * text that is shown, never for text that is written back.
 */
internal object WidgetText {

    private val CHECKBOX_MARKER = Regex("""^\s*-\s\[([ xX])\]\s?""")
    private val INLINE_WHITESPACE = Regex("""[ \t ]+""")
    // U+FFFC is what Html.fromHtml leaves behind for <img> and other objects.
    private const val OBJECT_CHAR = "￼"

    /** True when the note should be rendered as a checklist. */
    fun isChecklist(note: NoteEntity): Boolean =
        note.type.equals("list", ignoreCase = true) ||
            note.content.lineSequence().any { ChecklistMarkdown.parse(it) != null }

    /** HTML (or plain) text -> non-blank plain-text lines, tags and entities resolved. */
    fun plainLines(html: String): List<String> {
        if (html.isBlank()) return emptyList()
        return htmlToText(html)
            .split('\n')
            .map { INLINE_WHITESPACE.replace(it, " ").trim() }
            .filter { it.isNotEmpty() }
    }

    /** One line of a list note, or any single line, as plain text. */
    fun plainLine(raw: String): String =
        INLINE_WHITESPACE.replace(htmlToText(raw).replace('\n', ' '), " ").trim()

    /**
     * One-line preview for the configure-screen picker: checklist markers become
     * checkbox glyphs, everything else is run through the HTML parser.
     */
    fun previewLine(raw: String): String {
        val withBoxes = CHECKBOX_MARKER.replace(raw) { match ->
            if (match.groupValues[1].equals("x", ignoreCase = true)) "☑ " else "☐ "
        }
        return plainLine(withBoxes)
    }

    /** Title shown on widgets: the note title, else its first line of text. */
    fun displayTitle(note: NoteEntity, maxLength: Int = 60): String {
        if (note.title.isNotBlank()) return note.title
        val firstLine = if (isChecklist(note)) {
            note.content.lineSequence()
                .map { line -> ChecklistMarkdown.parse(line)?.text?.let { plainLine(it) } ?: plainLine(line) }
                .firstOrNull { it.isNotBlank() }
        } else {
            plainLines(note.content).firstOrNull()
        }
        return firstLine?.take(maxLength) ?: "Untitled"
    }

    private fun htmlToText(html: String): String {
        // Markdown/plain lines have no tags; skip the parser so their newlines survive.
        if (!html.contains('<') && !html.contains('&')) return html
        return android.text.Html
            .fromHtml(html, android.text.Html.FROM_HTML_MODE_LEGACY)
            .toString()
            .replace(OBJECT_CHAR, "")
    }
}

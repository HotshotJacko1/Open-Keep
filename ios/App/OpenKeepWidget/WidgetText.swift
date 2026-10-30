import Foundation

/// Turns a note's raw `content` into plain text for the widgets and the widget
/// setup sheet. Mirrors Android's WidgetText.kt so both platforms show the same text.
///
/// `content` holds one of two formats (see NoteEditor.tsx):
///  - list notes: checklist markdown, one `"${indent}- [x] text"` item per line
///  - text notes: the editor's HTML (`<p>...</p><p>...</p>`, usually on one line)
///
/// Showing either as-is leaks `<p>` tags or `- [ ]` markers. This is only for text
/// that is shown, never for text that is written back to the note.
enum WidgetText {

    private static let checkboxItem = try! NSRegularExpression(pattern: "^\\s*-\\s\\[([ xX])\\]\\s?(.*)$")
    private static let numericEntity = try! NSRegularExpression(pattern: "&#([xX]?)([0-9A-Fa-f]+);")

    /// HTML (or plain) text as non-blank plain-text lines, tags and entities resolved.
    static func plainLines(_ html: String) -> [String] {
        htmlToText(html)
            .components(separatedBy: "\n")
            .map(collapseWhitespace)
            .filter { !$0.isEmpty }
    }

    /// One line of a note as a single line of plain text.
    static func plainLine(_ raw: String) -> String {
        collapseWhitespace(htmlToText(raw).replacingOccurrences(of: "\n", with: " "))
    }

    /// One line for the note picker: checklist markers become checkbox glyphs.
    static func previewLine(_ raw: String) -> String {
        if let item = checklistItem(raw) {
            return plainLine((item.isChecked ? "☑ " : "☐ ") + item.text)
        }
        return plainLine(raw)
    }

    /// The note picker's subtitle: up to three lines, as Android's setup screen shows.
    static func pickerPreview(_ content: String) -> String {
        let lines = content
            .components(separatedBy: "\n")
            .map(previewLine)
            .filter { !$0.isEmpty }
            .prefix(3)
        return String(lines.joined(separator: "   ").prefix(120))
    }

    /// The note picker's title: the note title, else its first line, checkbox glyph included.
    static func pickerTitle(title: String, content: String) -> String {
        if !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return title }
        let firstLine = content
            .components(separatedBy: "\n")
            .map(previewLine)
            .first(where: { !$0.isEmpty })
        return firstLine.map { String($0.prefix(60)) } ?? "Untitled"
    }

    /// Title shown on widgets: the note title, else its first line of text.
    static func displayTitle(title: String, content: String, maxLength: Int = 60) -> String {
        if !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return title }
        for line in content.components(separatedBy: "\n") {
            let text = checklistItem(line).map { plainLine($0.text) } ?? plainLines(line).first ?? ""
            if !text.isEmpty { return String(text.prefix(maxLength)) }
        }
        return "Untitled"
    }

    private static func checklistItem(_ line: String) -> (isChecked: Bool, text: String)? {
        let range = NSRange(line.startIndex..., in: line)
        guard let match = checkboxItem.firstMatch(in: line, options: [], range: range),
              let boxRange = Range(match.range(at: 1), in: line),
              let textRange = Range(match.range(at: 2), in: line) else {
            return nil
        }
        return (line[boxRange].lowercased() == "x", String(line[textRange]))
    }

    private static func htmlToText(_ html: String) -> String {
        // Markdown and plain lines have no tags; leave them alone so their newlines survive.
        guard html.contains("<") || html.contains("&") else { return html }
        var text = html
        // Line breaks and the ends of blocks become newlines, then every other tag goes.
        text = text.replacingOccurrences(
            of: "<br\\s*/?>", with: "\n", options: [.regularExpression, .caseInsensitive])
        text = text.replacingOccurrences(
            of: "</(p|div|li|h[1-6]|blockquote|pre)>", with: "\n", options: [.regularExpression, .caseInsensitive])
        text = text.replacingOccurrences(of: "<[^>]*>", with: "", options: .regularExpression)
        return decodeEntities(text)
    }

    private static func decodeEntities(_ text: String) -> String {
        guard text.contains("&") else { return text }
        let named = ["&nbsp;": " ", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'"]
        var result = text
        for (entity, value) in named {
            result = result.replacingOccurrences(of: entity, with: value)
        }
        let mutable = NSMutableString(string: result)
        let matches = numericEntity.matches(in: result, options: [], range: NSRange(location: 0, length: mutable.length))
        for match in matches.reversed() {
            let isHex = match.range(at: 1).length > 0
            let digits = mutable.substring(with: match.range(at: 2))
            if let code = UInt32(digits, radix: isHex ? 16 : 10), let scalar = Unicode.Scalar(code) {
                mutable.replaceCharacters(in: match.range, with: String(Character(scalar)))
            }
        }
        // Last, so an escaped "&amp;lt;" ends up as the text "&lt;".
        return (mutable as String).replacingOccurrences(of: "&amp;", with: "&")
    }

    private static func collapseWhitespace(_ line: String) -> String {
        line.replacingOccurrences(of: "[ \\t\\u00A0]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }
}

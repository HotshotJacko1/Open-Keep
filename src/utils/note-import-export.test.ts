// Copyright (c) 2026. Licensed under AGPLv3.
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { Note } from "@/types/note";

vi.mock("@/lib/image-storage", () => ({
  readImageBase64: vi.fn(async () => "aGVsbG8="),
}));

import { addNotesToZip } from "./note-export";
import { parseNoteMarkdown, serializeNoteToMarkdown } from "./note-markdown-format";
import { MarkdownImporter } from "./importers/markdown";
import { GoogleKeepImporter } from "./importers/google-keep";
import { ImportManager } from "./import-manager";

const note = (overrides: Partial<Note>): Note => ({
  id: "00000000-0000-4000-8000-000000000000",
  title: "",
  content: "<p>body</p>",
  type: "text",
  tags: [],
  isPinned: false,
  isArchived: false,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
} as Note);

describe("addNotesToZip (C3-33)", () => {
  it("keeps notes whose titles and id prefixes collide", async () => {
    const zip = new JSZip();
    await addNotesToZip(zip, [
      note({ id: "abcd1111-0000-4000-8000-000000000000", title: "" }),
      note({ id: "abcd1111-0000-4000-8000-000000000001", title: "" }),
      note({ id: "abcd2222-0000-4000-8000-000000000000", title: "Список" }),
      note({ id: "abcd2222-0000-4000-8000-000000000001", title: "Покупки" }),
    ]);
    const files = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name);
    expect(files).toHaveLength(4);
  });

  it("gives same-titled notes separate image folders", async () => {
    const zip = new JSZip();
    await addNotesToZip(zip, [
      note({ id: "aaaa0000-1", title: "Trip", images: ["images/img_a.jpg"] }),
      note({ id: "bbbb0000-1", title: "Trip", images: ["images/img_a.jpg"] }),
    ]);
    const images = Object.values(zip.files).filter((f) => !f.dir && f.name.endsWith(".jpg"));
    expect(images).toHaveLength(2);
  });
});

describe("markdown title round-trip (C3-36)", () => {
  it("keeps a multi-line title out of the body", () => {
    const md = serializeNoteToMarkdown(note({ title: "Line one\nLine two" }));
    const parsed = parseNoteMarkdown(md, "fallback");
    expect(parsed.title).toBe("Line one\nLine two");
    expect(parsed.content).toBe("<p>body</p>");
  });

  it("still reads a multi-line title from an older export", () => {
    const old = '---\ntitle: "Line one\\nLine two"\n---\n# Line one\nLine two\n\n<p>body</p>';
    expect(parseNoteMarkdown(old, "fallback").content).toBe("<p>body</p>");
  });

  it("keeps a hand-written heading that differs from the frontmatter title", () => {
    const md = '---\ntitle: "Groceries"\n---\n# Monday\n- eggs\n';
    const parsed = parseNoteMarkdown(md, "fallback");
    expect(parsed.title).toBe("Groceries");
    expect(parsed.content).toContain("# Monday");
  });

  it("still takes the heading as the title without frontmatter", () => {
    const parsed = parseNoteMarkdown("# Plain\n\nhello", "fallback");
    expect(parsed.title).toBe("Plain");
    expect(parsed.content).toBe("hello");
  });
});

describe("importers", () => {
  it("skips macOS AppleDouble files (C3-37)", async () => {
    const notes = await new MarkdownImporter().parse({
      files: [
        { name: "note.md", content: "# Note\n\nhi" },
        { name: "._note.md", content: "\u0000\u0005\u0016\u0007Mac OS X" },
      ],
    });
    expect(notes).toHaveLength(1);
  });

  it("imports only Keep-shaped JSON from a Takeout batch (C3-38)", async () => {
    const keep = JSON.stringify({ title: "Shopping", textContent: "milk", isTrashed: false, createdTimestampUsec: 1000 });
    const { notes, report } = await new ImportManager().run({
      files: [
        { name: "Shopping.json", content: keep },
        { name: "Settings.json", content: '{"theme":"dark"}' },
        { name: "Labels.json", content: "[]" },
      ],
    });
    expect(notes.map((n) => n.title)).toEqual(["Shopping"]);
    expect(report.filesSkipped).toBe(2);
    expect(new GoogleKeepImporter().handles({ name: "Settings.json", content: '{"theme":"dark"}' })).toBe(false);
  });
});

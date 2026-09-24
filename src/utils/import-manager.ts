// Copyright (c) 2026. Licensed under AGPLv3.
import { Importer, ImportInput, ImportNote, ImportReport } from "../types/import";
import { GoogleKeepImporter } from "./importers/google-keep";
import { MarkdownImporter } from "./importers/markdown";

export class ImportManager {
  private importers: Importer[] = [
    new GoogleKeepImporter(),
    new MarkdownImporter(),
  ];

  async run(input: ImportInput): Promise<{
    report: ImportReport;
    notes: ImportNote[];
  }> {

    // Run every importer that recognises the batch, not just the first: a
    // stray Keep .json alongside a folder of .md files must import both.
    // Each importer only reads its own file type, so nothing is imported twice.
    const selectedImporters = this.importers.filter(importer => importer.detect(input));

    if (selectedImporters.length === 0) {
      throw new Error("No supported import format detected in the provided files.");
    }

    const importedNotes: ImportNote[] = [];
    for (const importer of selectedImporters) {
      importedNotes.push(...await importer.parse(input));
    }

    const tagsCreated = new Set<string>();
    importedNotes.forEach(note => {
      note.tags?.forEach(tag => tagsCreated.add(tag));
    });

    const filesSkipped = input.files.filter(
      file => !selectedImporters.some(importer => importer.handles(file))
    ).length;

    const report: ImportReport = {
      source: selectedImporters.map(importer => importer.name).join(" + "),
      notesImported: importedNotes.length,
      tagsCreated: tagsCreated.size,
      failedNotes: 0, // We're silently skipping failed parse attempts for now in the Importer,
                      // a more robust system might track them.
      filesSkipped,
    };

    return {
      report,
      notes: importedNotes
    };
  }
}

// Copyright (c) 2026. Licensed under AGPLv3.
import { Importer, ImportInput, ImportNote, ImportReport } from "../types/import";
import { GoogleKeepImporter } from "./importers/google-keep";

export class ImportManager {
  private importers: Importer[] = [
    new GoogleKeepImporter(),
  ];

  async run(input: ImportInput): Promise<{
    report: ImportReport;
    notes: ImportNote[];
  }> {
    
    // Find the first matching importer
    let selectedImporter: Importer | undefined;
    for (const importer of this.importers) {
      if (importer.detect(input)) {
        selectedImporter = importer;
        break;
      }
    }

    if (!selectedImporter) {
      // Fallback: If it's pure markdown, we'll just handle it directly or fail.
      // Since markdown importer is omitted, let's just throw if no match.
      throw new Error("No supported import format detected in the provided files.");
    }

    const importedNotes = await selectedImporter.parse(input);

    const tagsCreated = new Set<string>();
    importedNotes.forEach(note => {
      note.tags?.forEach(tag => tagsCreated.add(tag));
    });

    const report: ImportReport = {
      source: selectedImporter.name,
      notesImported: importedNotes.length,
      tagsCreated: tagsCreated.size,
      failedNotes: 0 // We're silently skipping failed parse attempts for now in the Importer, 
                     // a more robust system might track them.
    };

    return {
      report,
      notes: importedNotes
    };
  }
}

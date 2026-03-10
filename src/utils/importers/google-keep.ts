import { Importer, ImportInput, ImportNote } from "../../types/import";

interface KeepNoteLabel {
  name: string;
}

interface KeepListItem {
  text: string;
  isChecked: boolean;
}

interface KeepNote {
  title?: string;
  textContent?: string;
  listContent?: KeepListItem[];
  labels?: KeepNoteLabel[];
  isPinned?: boolean;
  isArchived?: boolean;
  isTrashed?: boolean;
  createdTimestampUsec?: number;
  userEditedTimestampUsec?: number;
}

export class GoogleKeepImporter implements Importer {
  name = "Google Keep";

  detect(input: ImportInput): boolean {
    // Detect if we have any .json file that looks like a Keep note
    // Usually Google Keep exports have 'Takeout/Keep/' paths, but we simplify to just looking for JSON
    // with properties we expect in Keep, or just any .json file for this specific importer since
    // it's our primary one. We'll check if the file name ends with .json.
    return input.files.some(f => f.name.endsWith(".json") && (f.name.includes("Takeout") || f.name.includes("Keep") || true)); // Relaxed detection
  }

  async parse(input: ImportInput): Promise<ImportNote[]> {
    const notes: ImportNote[] = [];

    for (const file of input.files) {
      if (!file.name.endsWith(".json")) continue;

      try {
        const keepData = JSON.parse(file.content) as KeepNote;

        // Skip trashed exported notes if they explicitly say trashed, though user might want them? Let's skip trashed by default.
        if (keepData.isTrashed) {
          continue;
        }

        const tags = (keepData.labels || []).map(l => l.name);
        
        // Convert list to markdown checklist if present
        let body = keepData.textContent || "";
        if (keepData.listContent && keepData.listContent.length > 0) {
          const listMarkdown = keepData.listContent
            .map(item => `- [${item.isChecked ? 'x' : ' '}] ${item.text}`)
            .join("\n");
          body = body ? `${body}\n\n${listMarkdown}` : listMarkdown;
        }

        // Keep timestamps are in microseconds (usec), JS Date needs milliseconds
        const createdAt = keepData.createdTimestampUsec 
          ? Math.floor(keepData.createdTimestampUsec / 1000) 
          : Date.now();
        const updatedAt = keepData.userEditedTimestampUsec 
          ? Math.floor(keepData.userEditedTimestampUsec / 1000) 
          : createdAt;

        notes.push({
          title: keepData.title || "Untitled",
          content: body,
          tags: tags,
          isPinned: !!keepData.isPinned,
          isArchived: !!keepData.isArchived,
          createdAt: createdAt,
          updatedAt: updatedAt
        });

      } catch (e) {
        console.warn(`Failed to parse Keep JSON file: ${file.name}`, e);
        // Continue to the next file if one fails to parse
      }
    }

    return notes;
  }
}

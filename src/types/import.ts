import { Note } from "./note";

export interface ImportInputFile {
  name: string;
  content: string;
  path?: string;
}

export interface ImportInput {
  files: ImportInputFile[];
}

// We map directly to the internal Note format for simplicity, 
// using Omit to allow flexible ID and timestamp generation if needed, 
// but for a true universal format, we might define an intermediate type.
// Since the prompt suggested ImportNote -> Note, let's define it.
export type ImportNote = Omit<Note, 'id'> & { id?: string };

export interface ImportReport {
  source: string;
  notesImported: number;
  tagsCreated: number;
  failedNotes: number;
}

export interface Importer {
  name: string;
  detect(input: ImportInput): boolean;
  parse(input: ImportInput): Promise<ImportNote[]>;
}

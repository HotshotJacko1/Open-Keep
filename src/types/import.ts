// Copyright (c) 2026. Licensed under AGPLv3.
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
export type ImportNote = Omit<Note, 'id'> & { id?: string; images?: string[] };

export interface ImportReport {
  source: string;
  notesImported: number;
  tagsCreated: number;
  failedNotes: number;
  /** Input files that no selected importer reads (e.g. a non-Keep .json). */
  filesSkipped: number;
}

export interface Importer {
  name: string;
  detect(input: ImportInput): boolean;
  /** Whether parse() would read this file, once the importer is selected. */
  handles(file: ImportInputFile): boolean;
  parse(input: ImportInput): Promise<ImportNote[]>;
}

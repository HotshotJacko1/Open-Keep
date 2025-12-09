import React, { useState, useEffect, useMemo } from "react";
import { MadeWithDyad } from "@/components/made-with-dyad";
import { Note } from "@/types/note";
import { loadNotes, saveNotes } from "@/lib/note-storage";
import NoteCard from "@/components/NoteCard";
import NoteEditor from "@/components/NoteEditor";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";

const Index = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    setNotes(loadNotes());
  }, []);

  useEffect(() => {
    saveNotes(notes);
  }, [notes]);

  const handleSaveNote = (noteToSave: Note) => {
    setNotes((prevNotes) => {
      const existingNoteIndex = prevNotes.findIndex((n) => n.id === noteToSave.id);
      if (existingNoteIndex > -1) {
        const updatedNotes = [...prevNotes];
        updatedNotes[existingNoteIndex] = noteToSave;
        return updatedNotes;
      } else {
        return [noteToSave, ...prevNotes];
      }
    });
  };

  const handleEditNote = (note: Note) => {
    setEditingNote(note);
    setIsEditorOpen(true);
  };

  const handlePinToggle = (id: string) => {
    setNotes((prevNotes) =>
      prevNotes.map((note) =>
        note.id === id ? { ...note, isPinned: !note.isPinned } : note
      )
    );
  };

  const handleArchiveToggle = (id: string) => {
    setNotes((prevNotes) =>
      prevNotes.map((note) =>
        note.id === id ? { ...note, isArchived: !note.isArchived } : note
      )
    );
  };

  const handleDeleteNote = (id: string) => {
    setNotes((prevNotes) => prevNotes.filter((note) => note.id !== id));
  };

  const filteredNotes = useMemo(() => {
    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    return notes
      .filter(
        (note) =>
          note.title.toLowerCase().includes(lowerCaseSearchTerm) ||
          note.content.toLowerCase().includes(lowerCaseSearchTerm) ||
          note.tags.some(tag => tag.toLowerCase().includes(lowerCaseSearchTerm))
      )
      .sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return b.updatedAt - a.updatedAt; // Sort by most recently updated
      });
  }, [notes, searchTerm]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold mb-6 text-center">My Markdown Notes</h1>

        <div className="mb-6 flex justify-center">
          <Input
            type="text"
            placeholder="Search notes by title, content, or tags..."
            className="w-full max-w-md p-2 rounded-lg shadow-sm focus:ring-2 focus:ring-primary"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div
          className="grid gap-4"
          style={{
            columnCount: "auto",
            columnGap: "1rem",
            columnWidth: "min(100%, 280px)", // Responsive column width
          }}
        >
          {filteredNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onEdit={handleEditNote}
              onPinToggle={handlePinToggle}
              onArchiveToggle={handleArchiveToggle}
              onDelete={handleDeleteNote}
            />
          ))}
        </div>

        <Button
          className="fixed bottom-8 right-8 p-4 rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-200"
          size="icon"
          onClick={() => {
            setEditingNote(undefined);
            setIsEditorOpen(true);
          }}
        >
          <Plus className="h-6 w-6" />
        </Button>

        <NoteEditor
          isOpen={isEditorOpen}
          onClose={() => setIsEditorOpen(false)}
          onSave={handleSaveNote}
          initialNote={editingNote}
        />
      </div>
      <MadeWithDyad />
    </div>
  );
};

export default Index;
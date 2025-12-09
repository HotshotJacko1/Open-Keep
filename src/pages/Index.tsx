import React, { useState, useEffect, useMemo } from "react";
import { Note } from "@/types/note";
import { loadNotes, saveNotes } from "@/lib/note-storage";
import NoteCard from "@/components/NoteCard";
import NoteEditor from "@/components/NoteEditor";
import SidebarNav from "@/components/SidebarNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Menu, Lightbulb } from "lucide-react"; // Added Lightbulb import
import { useSearchParams } from "react-router-dom";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

const Index = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchParams] = useSearchParams();
  const selectedTag = searchParams.get("tag");
  const isMobile = useIsMobile();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

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

  const uniqueTags = useMemo(() => {
    const allTags = notes.flatMap((note) => note.tags);
    return Array.from(new Set(allTags)).sort();
  }, [notes]);

  const filteredNotes = useMemo(() => {
    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    return notes
      .filter((note) => {
        const matchesSearch =
          note.title.toLowerCase().includes(lowerCaseSearchTerm) ||
          note.content.toLowerCase().includes(lowerCaseSearchTerm) ||
          note.tags.some((tag) => tag.toLowerCase().includes(lowerCaseSearchTerm));
        const matchesTag = selectedTag ? note.tags.includes(selectedTag) : true;
        return matchesSearch && matchesTag;
      })
      .sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return b.updatedAt - a.updatedAt; // Sort by most recently updated
      });
  }, [notes, searchTerm, selectedTag]);

  const mainContent = (
    <div className="flex flex-col flex-1 p-4 sm:p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        {isMobile && (
          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="mr-2">
                <Menu className="h-6 w-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0 bg-sidebar-background text-sidebar-foreground border-r-sidebar-border">
              <div className="p-4 text-2xl font-bold text-sidebar-primary flex items-center">
                <Lightbulb className="mr-2 h-6 w-6 text-yellow-500" fill="currentColor" />
                Keep
              </div>
              <SidebarNav uniqueTags={uniqueTags} onClose={() => setIsSheetOpen(false)} />
            </SheetContent>
          </Sheet>
        )}
        <h1 className="text-4xl font-bold text-center flex-1">My Markdown Notes</h1>
      </div>

      <div className="mb-6 flex justify-center">
        <Input
          type="text"
          placeholder="Search notes by title, content, or tags..."
          className="w-full max-w-md p-2 rounded-lg shadow-sm focus:ring-2 focus:ring-primary bg-card text-card-foreground border-input"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div
        className="grid gap-4"
        style={{
          columnCount: "auto",
          columnGap: "1rem",
          columnWidth: "min(100%, 280px)",
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
  );

  return (
    <div className="min-h-screen bg-neutral-100 dark:bg-[#202124] text-gray-900 dark:text-gray-50">
      {isMobile ? (
        mainContent
      ) : (
        <ResizablePanelGroup direction="horizontal" className="min-h-screen">
          <ResizablePanel defaultSize={15} minSize={10} maxSize={25} className="bg-sidebar-background text-sidebar-foreground border-r-sidebar-border">
            <div className="p-4 text-2xl font-bold text-sidebar-primary flex items-center">
              <Lightbulb className="mr-2 h-6 w-6 text-yellow-500" fill="currentColor" />
              Keep
            </div>
            <SidebarNav uniqueTags={uniqueTags} />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={85}>
            {mainContent}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
};

export default Index;
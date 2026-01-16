import React, { useState, useEffect, useMemo } from "react";
import { Note, NoteType, TextNote, ListNote } from "@/types/note";
import { loadNotes, saveNotes } from "@/lib/note-storage";
import NoteCard from "@/components/NoteCard";
import TextNoteEditor from "@/components/TextNoteEditor";
import ListNoteEditor from "@/components/ListNoteEditor";
import SidebarNav from "@/components/SidebarNav";
import SettingsDialog from "@/components/SettingsDialog";
import AddNoteOptions from "@/components/AddNoteOptions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu, Lightbulb, Settings } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSession } from '@/context/session-provider';

import { showSuccess } from "@/utils/toast";
import { SelectionActionBar } from "@/components/SelectionActionBar";
import JSZip from "jszip";
import { saveAs } from "file-saver";

const Index = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isTextEditorOpen, setIsTextEditorOpen] = useState(false);
  const [isListEditorOpen, setIsListEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchParams] = useSearchParams();
  const [selectedTag, setSelectedTag] = useState<string | null>(searchParams.get("tag"));
  const isMobile = useIsMobile();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());

  // Derive selection mode from selected count
  const isSelectionMode = selectedNoteIds.size > 0;

  // Sync selectedTag with URL search params
  useEffect(() => {
    setSelectedTag(searchParams.get("tag"));
  }, [searchParams]);

  const { session, supabase } = useSession();

  // Load notes on mount, regardless of session
  useEffect(() => {
    setNotes(loadNotes());
  }, []); // Only run once on mount

  // We no longer rely on session to load/clear notes initially
  // useEffect(() => {
  //   if (session) {
  //     setNotes(loadNotes());
  //   } else {
  //     setNotes([]); // Clear notes if not logged in
  //   }
  // }, [session]); 

  useEffect(() => {
    // Save notes whenever they change. 
    // We allow saving even if !session because storage is local.
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
    if (note.type === NoteType.Text) {
      setIsTextEditorOpen(true);
    } else {
      setIsListEditorOpen(true);
    }
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

  const handleToggleListItem = (noteId: string, itemId: string) => {
    setNotes((prevNotes) =>
      prevNotes.map((note) => {
        if (note.id === noteId && note.type === NoteType.List) {
          const listNote = note as ListNote;
          return {
            ...listNote,
            items: listNote.items.map((item) =>
              item.id === itemId ? { ...item, isCompleted: !item.isCompleted } : item
            ),
            updatedAt: Date.now(), // Update timestamp when an item is toggled
          };
        }
        return note;
      })
    );
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
          note.tags.some((tag) => tag.toLowerCase().includes(lowerCaseSearchTerm)) ||
          (note.type === NoteType.Text && (note as TextNote).content.toLowerCase().includes(lowerCaseSearchTerm)) ||
          (note.type === NoteType.List && (note as ListNote).items.some(item => item.content.toLowerCase().includes(lowerCaseSearchTerm)));
        const matchesTag = selectedTag ? note.tags.includes(selectedTag) : true;
        return matchesSearch && matchesTag;
      })
      .sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return b.updatedAt - a.updatedAt; // Sort by most recently updated
      });
  }, [notes, searchTerm, selectedTag]);

  const handleNewTextNote = () => {
    setEditingNote(undefined);
    setIsTextEditorOpen(true);
  };

  const handleNewListNote = () => {
    setEditingNote(undefined);
    setIsListEditorOpen(true);
  };

  // Selection Handlers
  const handleSelectNote = (id: string, selected: boolean) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedNoteIds(new Set());
  };

  const handleBulkPin = () => {
    setNotes((prevNotes) => {
      // Determine if we should pin or unpin based on the first selected note
      // Or: if any are unpinned, pin them all. If all are pinned, unpin them all.
      // Let's go with: if any selected is unpinned, pin all selected. Otherwise unpin all.
      const selectedNotes = prevNotes.filter(n => selectedNoteIds.has(n.id));
      const anyUnpinned = selectedNotes.some(n => !n.isPinned);

      return prevNotes.map(note => {
        if (selectedNoteIds.has(note.id)) {
          return { ...note, isPinned: anyUnpinned };
        }
        return note;
      });
    });
    // Optional: Keep selection or clear it? Google Keep keeps it.
  };

  const handleBulkArchive = () => {
    setNotes((prevNotes) =>
      prevNotes.map(note => {
        if (selectedNoteIds.has(note.id)) {
          return { ...note, isArchived: !note.isArchived }; // Toggle or just archive? Usually "Archive" action means archive. But if we are in Archive view?
          // For now let's assume "Archive" action always archives. 
          // But wait, the button says "Archive". If we are in "Archived" view, maybe it should be "Unarchive".
          // Keep simplifies: The button toggles or there are separate buttons. 
          // Let's simple toggle 'isArchived' to TRUE for now, or toggle if it's already there?
          // Google Keep has "Archive" button. If note is archived, it has "Unarchive".
          // Let's implement toggle for now, or just force true.
          // Requirement: "Archive". 
          return { ...note, isArchived: true };
        }
        return note;
      })
    );
    handleClearSelection();
    showSuccess("Notes archived");
  };

  const handleBulkDelete = () => {
    setNotes((prevNotes) => prevNotes.filter(note => !selectedNoteIds.has(note.id)));
    handleClearSelection();
    showSuccess("Notes deleted");
  };

  const handleBulkExport = async () => {
    const zip = new JSZip();
    const selectedNotes = notes.filter((n) => selectedNoteIds.has(n.id));

    selectedNotes.forEach((note) => {
      let content = "";
      if (note.type === NoteType.Text) {
        content = (note as TextNote).content;
      } else {
        content = (note as ListNote).items
          .map((item) => `${item.isCompleted ? "[x]" : "[ ]"} ${item.content}`)
          .join("\n");
      }

      // Sanitize title for filename
      const filename = `${note.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50) || 'untitled'}_${note.id.substring(0, 4)}.md`;
      zip.file(filename, `# ${note.title}\n\n${content}`);
    });

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "notes_export.zip");
    handleClearSelection();
    showSuccess("Exported notes");
  };

  // Handle Esc key to clear selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isSelectionMode) {
        handleClearSelection();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSelectionMode]);

  // Click outside listener
  const handleBackgroundClick = (e: React.MouseEvent) => {
    // Only clear if clicking directly on the background container
    if (isSelectionMode && e.target === e.currentTarget) {
      handleClearSelection();
    }
  };



  // Tag management for selection
  const tagStates = useMemo(() => {
    const states: Record<string, boolean | 'indeterminate'> = {};
    const selectedNotes = notes.filter(n => selectedNoteIds.has(n.id));
    if (selectedNotes.length === 0) return states;

    uniqueTags.forEach(tag => {
      const hasTagCount = selectedNotes.filter(n => n.tags.includes(tag)).length;
      if (hasTagCount === selectedNotes.length) {
        states[tag] = true;
      } else if (hasTagCount > 0) {
        states[tag] = 'indeterminate';
      } else {
        states[tag] = false;
      }
    });
    return states;
  }, [selectedNoteIds, notes, uniqueTags]);

  const handleTagToggle = (tag: string) => {
    setNotes(prevNotes => {
      const selectedNotes = prevNotes.filter(n => selectedNoteIds.has(n.id));
      const allHave = selectedNotes.every(n => n.tags.includes(tag));

      // If all have it, remove it.
      // If some or none have it, add it.
      const shouldAdd = !allHave;

      return prevNotes.map(note => {
        if (selectedNoteIds.has(note.id)) {
          let newTags = note.tags;
          if (shouldAdd) {
            if (!newTags.includes(tag)) {
              newTags = [...newTags, tag];
            }
          } else {
            newTags = newTags.filter(t => t !== tag);
          }
          return { ...note, tags: newTags, updatedAt: Date.now() };
        }
        return note;
      });
    });
  };

  const mainContent = (
    <div className="flex flex-col flex-1 p-4 sm:p-6 md:p-8">
      {/* Combined top bar for mobile and desktop */}
      <div className="flex items-center gap-2 mb-6">
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
                <span className="text-[hsl(218_4%_39%)] dark:text-[#e2e2e3]">Keep</span>
              </div>
              <SidebarNav uniqueTags={uniqueTags} onClose={() => setIsSheetOpen(false)} />

            </SheetContent>
          </Sheet>
        )}

        <Input
          type="text"
          placeholder="Search notes by title, content, or tags..."
          className="flex-grow p-2 rounded-lg shadow focus:ring-2 focus:ring-primary bg-white dark:bg-[#202124] text-card-foreground border-input"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <Button variant="ghost" size="icon" onClick={() => setIsSettingsOpen(true)}>
          <Settings className="h-6 w-6 text-muted-foreground" />
        </Button>
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
            onToggleListItem={handleToggleListItem}
            isSelected={selectedNoteIds.has(note.id)}
            isSelectionMode={isSelectionMode}
            onSelect={handleSelectNote}
          />
        ))}
      </div>

      <AddNoteOptions
        onNewTextNote={handleNewTextNote}
        onNewListNote={handleNewListNote}
      />

      <TextNoteEditor
        isOpen={isTextEditorOpen}
        onClose={() => setIsTextEditorOpen(false)}
        onSave={handleSaveNote}
        onDelete={handleDeleteNote} // Pass onDelete prop
        initialNote={editingNote?.type === NoteType.Text ? (editingNote as TextNote) : undefined}
      />

      <ListNoteEditor
        isOpen={isListEditorOpen}
        onClose={() => setIsListEditorOpen(false)}
        onSave={handleSaveNote}
        onDelete={handleDeleteNote} // Pass onDelete prop
        initialNote={editingNote?.type === NoteType.List ? (editingNote as ListNote) : undefined}
      />

      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        notes={notes}
        onImportNotes={(importedNotes) => {
          setNotes((prev) => [...importedNotes, ...prev]);
        }}
      />
    </div >
  );

  return (
    <div
      className="min-h-screen bg-neutral-100 dark:bg-[#202124] text-foreground"
      onClick={handleBackgroundClick} // Handle click outside
    >
      <SelectionActionBar
        selectedCount={selectedNoteIds.size}
        onClearSelection={handleClearSelection}
        onPin={handleBulkPin}
        onArchive={handleBulkArchive}
        onDelete={handleBulkDelete}
        onExport={handleBulkExport}
        availableTags={uniqueTags}
        tagStates={tagStates}
        onTagToggle={handleTagToggle}
      />

      {isMobile ? (
        mainContent
      ) : (
        <ResizablePanelGroup direction="horizontal" className="min-h-screen">
          <ResizablePanel defaultSize={15} minSize={10} maxSize={25} className="bg-sidebar-background text-sidebar-foreground border-r-sidebar-border">
            <div className="p-4 text-2xl font-bold text-sidebar-primary flex items-center">
              <Lightbulb className="mr-2 h-6 w-6 text-yellow-500" fill="currentColor" />
              <span className="text-[hsl(218_4%_39%)] dark:text-[#e2e2e3]">Keep</span>
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
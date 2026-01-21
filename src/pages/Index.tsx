import React, { useState, useEffect, useMemo } from "react";
import { Note, NoteType, TextNote, ListNote } from "@/types/note";
import { loadNotes, saveNote, deleteNote, getLegacyWebNotes, migrateWebNotes, clearLegacyWebNotes } from "@/lib/note-storage";
import NoteCard from "@/components/NoteCard";
import TextNoteEditor from "@/components/TextNoteEditor";
import ListNoteEditor from "@/components/ListNoteEditor";
import { useGoogleDrive } from "@/hooks/use-google-drive";
import { useOneDrive } from "@/hooks/use-one-drive";
import { useDropbox } from "@/hooks/use-dropbox";
import { Loader2 } from "lucide-react";
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

  useEffect(() => {
    setSelectedTag(searchParams.get("tag"));
  }, [searchParams]);

  const { session, supabase } = useSession();

  // Cloud Sync Hooks
  const googleDrive = useGoogleDrive();
  const oneDrive = useOneDrive();
  const dropbox = useDropbox();

  const activeService = useMemo(() => {
    if (googleDrive.isConnected) return { ...googleDrive, name: "Google Drive" };
    if (oneDrive.isConnected) return { ...oneDrive, name: "OneDrive" };
    if (dropbox.isConnected) return { ...dropbox, name: "Dropbox" };
    return null;
  }, [googleDrive.isConnected, oneDrive.isConnected, dropbox.isConnected, googleDrive, oneDrive, dropbox]);

  // Pull to Refresh State
  const [pullStartPoint, setPullStartPoint] = useState(0);
  const [pullChange, setPullChange] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const PULL_THRESHOLD = 150; // px to trigger refresh

  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY === 0 && !isSelectionMode) {
      setPullStartPoint(e.targetTouches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (pullStartPoint > 0 && window.scrollY === 0 && !isSelectionMode) {
      const pullY = e.targetTouches[0].clientY;
      const dist = pullY - pullStartPoint;
      if (dist > 0) {
        // Resistance effect
        setPullChange(dist < PULL_THRESHOLD ? dist : PULL_THRESHOLD + (dist - PULL_THRESHOLD) * 0.3);
      }
    }
  };

  const handleTouchEnd = async () => {
    if (pullChange > PULL_THRESHOLD / 1.5 && activeService) {
      setIsRefreshing(true);
      setPullChange(60); // Hold position
      try {
        await activeService.sync();
        const loadedNotes = await loadNotes(); // Reload local notes after sync
        setNotes(loadedNotes);
        showSuccess(`Synced with ${activeService.name}`);
      } catch (error) {
        console.error("Sync failed", error);
      } finally {
        setIsRefreshing(false);
        setPullChange(0);
        setPullStartPoint(0);
      }
    } else {
      setPullChange(0);
      setPullStartPoint(0);
    }
  };

  // Load notes on mount + Migration Logic
  useEffect(() => {
    const initNotes = async () => {
      // MIGRATION CHECK
      const MIGRATION_KEY = 'migrated_to_native_v1';
      const hasMigrated = localStorage.getItem(MIGRATION_KEY);

      if (!hasMigrated) {
        const legacyNotes = getLegacyWebNotes();
        if (legacyNotes.length > 0) {
          console.log("Migrating notes to native database...", legacyNotes.length);
          await migrateWebNotes(legacyNotes);
          // clearLegacyWebNotes(); // Optional: keep for safety for now
        }
        localStorage.setItem(MIGRATION_KEY, 'true');
      }

      const loadedNotes = await loadNotes();
      setNotes(loadedNotes);
    };

    initNotes();
  }, []);

  const handleSaveNote = async (noteToSave: Note) => {
    // Optimistic Update
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

    // Write to DB
    await saveNote(noteToSave);
  };

  const handleEditNote = (note: Note) => {
    setEditingNote(note);
    if (note.type === NoteType.Text) {
      setIsTextEditorOpen(true);
    } else {
      setIsListEditorOpen(true);
    }
  };

  const handlePinToggle = async (id: string) => {
    const note = notes.find(n => n.id === id);
    if (!note) return;

    const updatedNote = { ...note, isPinned: !note.isPinned, updatedAt: Date.now() }; // User requested auto update time

    // UI Update
    setNotes((prevNotes) =>
      prevNotes.map((n) => (n.id === id ? updatedNote : n))
    );

    // DB Update
    await saveNote(updatedNote);
  };

  const handleArchiveToggle = async (id: string) => {
    const note = notes.find(n => n.id === id);
    if (!note) return;

    const updatedNote = { ...note, isArchived: !note.isArchived, updatedAt: Date.now() };

    setNotes((prevNotes) =>
      prevNotes.map((n) => (n.id === id ? updatedNote : n))
    );
    await saveNote(updatedNote);
  };

  const handleDeleteNote = async (id: string) => {
    // UI Update
    setNotes((prevNotes) => prevNotes.filter((note) => note.id !== id));
    // DB Update
    await deleteNote(id);
  };

  const handleToggleListItem = async (noteId: string, itemId: string) => {
    const note = notes.find(n => n.id === noteId);
    if (!note || note.type !== NoteType.List) return;

    const listNote = note as ListNote;
    const updatedNote = {
      ...listNote,
      items: listNote.items.map((item) =>
        item.id === itemId ? { ...item, isCompleted: !item.isCompleted } : item
      ),
      updatedAt: Date.now(),
    };

    setNotes((prevNotes) =>
      prevNotes.map((n) => (n.id === noteId ? updatedNote : n))
    );
    await saveNote(updatedNote);
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

  const handleBulkPin = async () => {
    // Logic: if any selected is unpinned, pin all. Else unpin all.
    const selectedNotes = notes.filter(n => selectedNoteIds.has(n.id));
    if (selectedNotes.length === 0) return;

    const anyUnpinned = selectedNotes.some(n => !n.isPinned);
    const newPinnedState = anyUnpinned;
    const now = Date.now();

    const updates: Note[] = [];

    const newNotes = notes.map(note => {
      if (selectedNoteIds.has(note.id)) {
        const updated = { ...note, isPinned: newPinnedState, updatedAt: now };
        updates.push(updated);
        return updated;
      }
      return note;
    });

    setNotes(newNotes);

    // Loop save. Parallel is fine.
    await Promise.all(updates.map(n => saveNote(n)));
  };

  const handleBulkArchive = async () => {
    const selectedNotes = notes.filter(n => selectedNoteIds.has(n.id));
    if (selectedNotes.length === 0) return;

    const now = Date.now();
    const updates: Note[] = [];

    const newNotes = notes.map(note => {
      if (selectedNoteIds.has(note.id)) {
        const updated = { ...note, isArchived: true, updatedAt: now }; // Always archive as per previous logic
        updates.push(updated);
        return updated;
      }
      return note;
    });

    setNotes(newNotes);
    await Promise.all(updates.map(n => saveNote(n)));

    handleClearSelection();
    showSuccess("Notes archived");
  };

  const handleBulkDelete = async () => {
    const idsToDelete = Array.from(selectedNoteIds);
    setNotes((prevNotes) => prevNotes.filter(note => !selectedNoteIds.has(note.id)));

    await Promise.all(idsToDelete.map(id => deleteNote(id)));

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

  const handleTagToggle = async (tag: string) => {
    // Calculate changes
    const selectedNotes = notes.filter(n => selectedNoteIds.has(n.id));
    if (selectedNotes.length === 0) return;

    const allHave = selectedNotes.every(n => n.tags.includes(tag));
    const shouldAdd = !allHave;
    const now = Date.now();
    const updates: Note[] = [];

    const newNotes = notes.map(note => {
      if (selectedNoteIds.has(note.id)) {
        let newTags = note.tags;
        if (shouldAdd) {
          if (!newTags.includes(tag)) newTags = [...newTags, tag];
        } else {
          newTags = newTags.filter(t => t !== tag);
        }
        const updated = { ...note, tags: newTags, updatedAt: now };
        updates.push(updated);
        return updated;
      }
      return note;
    });

    setNotes(newNotes);
    await Promise.all(updates.map(n => saveNote(n)));
  };

  const mainContent = (
    <div
      className="flex flex-col flex-1 px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] sm:px-6 sm:pb-6 sm:pt-[calc(1.5rem+env(safe-area-inset-top))] md:px-8 md:pb-8 md:pt-[calc(2rem+env(safe-area-inset-top))]"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        transform: `translateY(${pullChange > 0 ? pullChange : 0}px)`,
        transition: isRefreshing ? 'transform 0.2s ease-out' : pullChange === 0 ? 'transform 0.3s ease-out' : 'none'
      }}
    >
      {/* Pull to Refresh Indicator */}
      {(pullChange > 0 || isRefreshing) && (
        <div
          className="absolute top-[-50px] left-0 right-0 flex justify-center items-center h-[50px] transition-opacity duration-300"
          style={{ opacity: Math.min(pullChange / 50, 1) }}
        >
          {isRefreshing ? (
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          ) : (
            <span className="text-sm text-muted-foreground font-medium">Pull to sync</span>
          )}
        </div>
      )}
      {/* Combined top bar for mobile and desktop */}
      <div className="flex items-center gap-2 mb-6">
        {isMobile && (
          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="mr-2">
                <Menu className="h-6 w-6 text-muted-foreground" />
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
          importedNotes.forEach(saveNote); // Save imported notes
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
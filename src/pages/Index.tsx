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
import { Menu, Lightbulb, Settings, LogOut } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSession } from '@/context/session-provider';
import LoginDialog from '@/components/LoginDialog';
import { showSuccess } from "@/utils/toast";

const Index = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isTextEditorOpen, setIsTextEditorOpen] = useState(false);
  const [isListEditorOpen, setIsListEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchParams] = useSearchParams();
  const selectedTag = searchParams.get("tag");
  const isMobile = useIsMobile();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    showSuccess("Logged out successfully!");
  };

  // We no longer block access if !session. 
  // Anonymous auth happens in background in SessionProvider.
  // if (!session) {
  //   return (
  //     <div className="min-h-screen flex items-center justify-center bg-neutral-100 dark:bg-[#202124]">
  //       <LoginDialog isOpen={true} onClose={() => {}} />
  //     </div>
  //   );
  // }

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
              <div className="p-4 border-t border-sidebar-border mt-auto">
                <Button variant="ghost" onClick={handleLogout} className="w-full justify-start">
                  <LogOut className="h-4 w-4 mr-2" /> Logout
                </Button>
              </div>
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
        <Button variant="ghost" onClick={handleLogout}>
          <LogOut className="h-4 w-4 mr-2" /> Logout
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
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-neutral-100 dark:bg-[#202124] text-foreground">
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
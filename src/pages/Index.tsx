// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Note } from "@/types/note";
import { loadNotes, saveNote, deleteNote, getLegacyWebNotes, migrateWebNotes, clearLegacyWebNotes } from "@/lib/note-storage";
import { deleteImage } from "@/lib/image-storage";
import { Filesystem, Directory } from "@capacitor/filesystem";
import NoteCard from "@/components/NoteCard";
import NoteEditor from "@/components/NoteEditor"; // Unified Editor
import { useGoogleDrive } from "@/hooks/use-google-drive";
import { useOneDrive } from "@/hooks/use-one-drive";
import { useDropbox } from "@/hooks/use-dropbox";
import { Loader2 } from "lucide-react";
import SidebarNav from "@/components/SidebarNav";
import SettingsDialog from "@/components/SettingsDialog";
import EditLabels from "@/components/EditLabels";
import AddNoteOptions from "@/components/AddNoteOptions";
import InitialAskToMigrate from "@/components/InitialAskToMigrate";
import InitialEarlyAccessDialog from "@/components/InitialEarlyAccessDialog";
import GoogleKeepMigrationGuide from "@/components/GoogleKeepMigrationGuide";
import { Button } from "@/components/ui/button";
import { Menu, Lightbulb, Settings } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import TopBar from "@/components/TopBar";
import { useSession } from '@/context/session-provider';

import { showSuccess } from "@/utils/toast";
import { SelectionActionBar } from "@/components/SelectionActionBar";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { toggleCheckboxInContent } from "@/utils/markdown";
import { requestNotificationPermission, rescheduleAllReminders } from "@/utils/reminder";
import { App as CapacitorApp } from "@capacitor/app";

const Index = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [shouldAutoFocus, setShouldAutoFocus] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchParams] = useSearchParams();
  const [selectedTag, setSelectedTag] = useState<string | null>(searchParams.get("tag"));
  const isMobile = useIsMobile();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isEditLabelsOpen, setIsEditLabelsOpen] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [customTags, setCustomTags] = useState<string[]>(() => {
    const saved = localStorage.getItem("custom-tags");
    return saved ? JSON.parse(saved) : [];
  });
  const [showInitialMigrationAsk, setShowInitialMigrationAsk] = useState(false);
  const [showEarlyAccessDialog, setShowEarlyAccessDialog] = useState(false);
  const [showMigrationGuide, setShowMigrationGuide] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem("custom-tags", JSON.stringify(customTags));
  }, [customTags]);

  // Derive selection mode from selected count
  const isSelectionMode = selectedNoteIds.size > 0;

  // Sync selectedTag with URL search params
  useEffect(() => {
    setSelectedTag(searchParams.get("tag"));
  }, [searchParams]);

  const getHeaderContent = () => {
    if (selectedTag === "archive") {
      return <span className="text-[hsl(218_4%_39%)] dark:text-[#e2e2e3]">Archive</span>;
    }
    if (selectedTag === "bin") {
      return <span className="text-[hsl(218_4%_39%)] dark:text-[#e2e2e3]">Bin</span>;
    }
    if (selectedTag) {
      return <span className="text-[hsl(218_4%_39%)] dark:text-[#e2e2e3] truncate max-w-[150px]">{selectedTag}</span>;
    }
    return (
      <div className="hidden lg:flex items-center">
        <Lightbulb className="mr-2 h-6 w-6 text-yellow-500 flex-shrink-0" fill="currentColor" />
        <span className="text-[hsl(218_4%_39%)] dark:text-[#e2e2e3]">Keep</span>
      </div>
    );
  };

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
    // Check if we are at the top of the scroll container
    if (activeService && (!scrollContainerRef.current || scrollContainerRef.current.scrollTop === 0) && !isSelectionMode) {
      setPullStartPoint(e.targetTouches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (activeService && pullStartPoint > 0 && (!scrollContainerRef.current || scrollContainerRef.current.scrollTop === 0) && !isSelectionMode) {
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
        const syncResult = await activeService.sync();
        if (syncResult && syncResult.status === "success") {
          const loadedNotes = await loadNotes(); // Reload local notes after sync
          setNotes(loadedNotes);
          showSuccess(`Synced with ${activeService.name}`);
        } else if (syncResult && syncResult.status === "conflict") {
          // Open Sync Dialog to handle conflict
          window.dispatchEvent(new CustomEvent("open-sync-conflict", { 
            detail: { 
              service: activeService.name.toLowerCase().replace(" ", ""), 
              payload: (syncResult as any).cloudPayload, 
              reason: (syncResult as any).reason 
            } 
          }));
          setIsSettingsOpen(true); // Ensure settings is open so sync dialog can show
        }
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

      // Check for first launch / Keep Migration prompt (disabled â€” kept for future use)
      // const HAS_SEEN_MIGRATION_PROMPT = 'has_seen_keep_migration_prompt';
      // if (!localStorage.getItem(HAS_SEEN_MIGRATION_PROMPT)) {
      //   setShowInitialMigrationAsk(true);
      // }

      // Early Access welcome dialog â€” show once per user
      const HAS_SEEN_EARLY_ACCESS = 'has_seen_early_access_dialog_v1';
      if (!localStorage.getItem(HAS_SEEN_EARLY_ACCESS)) {
        setShowEarlyAccessDialog(true);
      }

      const loadedNotes = await loadNotes();

      // Request notification permissions (once) and reschedule any pending reminders
      await requestNotificationPermission();
      await rescheduleAllReminders(loadedNotes);

      // AUTO-DELETE CLEANUP (30 days)
      const now = Date.now();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      const notesToPermanentlyDelete = loadedNotes.filter(n => n.isDeleted && n.deletedAt && (now - n.deletedAt > thirtyDays));

      if (notesToPermanentlyDelete.length > 0) {
        console.log(`Cleaning up ${notesToPermanentlyDelete.length} old deleted notes`);
        await Promise.all(notesToPermanentlyDelete.map(async n => {
          if (n.images && n.images.length > 0) {
            await Promise.all(n.images.map(deleteImage));
          }
          await deleteNote(n.id);
        }));
        const idsToDelete = new Set(notesToPermanentlyDelete.map(n => n.id));
        setNotes(loadedNotes.filter(n => !idsToDelete.has(n.id)));
      } else {
        setNotes(loadedNotes);
      }
    };

    initNotes();
  }, []);

  // Reload notes whenever cloud sync writes to the DB
  useEffect(() => {
    const handleNotesUpdated = async () => {
      const reloadedNotes = await loadNotes();
      setNotes(reloadedNotes);

      const savedTags = localStorage.getItem("custom-tags");
      if (savedTags) {
        setCustomTags(JSON.parse(savedTags));
      }
    };
    window.addEventListener("notes-updated", handleNotesUpdated);
    return () => window.removeEventListener("notes-updated", handleNotesUpdated);
  }, []);


  // Back Button Handler (Mobile)
  useEffect(() => {
    const setupBackButton = async () => {
      const listener = await CapacitorApp.addListener("backButton", ({ canGoBack }) => {
        if (isEditLabelsOpen) {
          setIsEditLabelsOpen(false);
        } else if (isSheetOpen) {
          setIsSheetOpen(false);
        } else if (selectedNoteIds.size > 0) {
          setSelectedNoteIds(new Set()); // Clear selection
        } else if (canGoBack) {
          // Defer to browser history for Settings, NoteEditor, and nested dialogs
          window.history.back();
        } else {
          // If none of the above, exit app
          CapacitorApp.exitApp();
        }
      });

      return listener;
    };

    const listenerPromise = setupBackButton();

    return () => {
      listenerPromise.then(listener => listener.remove());
    };
  }, [isEditLabelsOpen, isSheetOpen, selectedNoteIds]);

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
    setShouldAutoFocus(false);
    setIsEditorOpen(true);
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
    const note = notes.find((n) => n.id === id);
    if (!note) return;

    if (note.isDeleted) {
      // Permanent Delete
      if (note.images && note.images.length > 0) {
        await Promise.all(note.images.map(deleteImage));
      }
      setNotes((prevNotes) => prevNotes.filter((n) => n.id !== id));
      await deleteNote(id);
      showSuccess("Note permanently deleted");
    } else {
      // Soft Delete
      const updatedNote = {
        ...note,
        isDeleted: true,
        deletedAt: Date.now(),
        isPinned: false, // Unpin when deleting
        updatedAt: Math.max(Date.now(), note.updatedAt + 1)
      };

      setNotes((prevNotes) =>
        prevNotes.map((n) => (n.id === id ? updatedNote : n))
      );
      await saveNote(updatedNote);
      showSuccess("Note moved to Bin");
    }
  };

  const handleRestoreNote = async (id: string) => {
    const note = notes.find((n) => n.id === id);
    if (!note) return;

    const updatedNote = {
      ...note,
      isDeleted: false,
      deletedAt: undefined,
      updatedAt: Date.now()
    };

    setNotes((prevNotes) =>
      prevNotes.map((n) => (n.id === id ? updatedNote : n))
    );
    await saveNote(updatedNote);
    showSuccess("Note restored");
  };

  const handleToggleListItem = async (noteId: string, itemId: string) => {
    // Extract line index from "line-{index}"
    const match = itemId.match(/^line-(\d+)$/);
    if (!match) return;
    const lineIndex = parseInt(match[1], 10);
    if (isNaN(lineIndex)) return;

    const note = notes.find(n => n.id === noteId);
    if (!note) return;

    const newContent = toggleCheckboxInContent(note.content, lineIndex);

    const updatedNote = {
      ...note,
      content: newContent,
      updatedAt: Date.now(),
    };

    setNotes((prevNotes) =>
      prevNotes.map((n) => (n.id === noteId ? updatedNote : n))
    );
    await saveNote(updatedNote);
  };

  const uniqueTags = useMemo(() => {
    const noteTags = notes.flatMap((note) => note.tags);
    return Array.from(new Set([...noteTags, ...customTags])).sort();
  }, [notes, customTags]);

  const filteredNotes = useMemo(() => {
    const isArchiveView = selectedTag === "archive";
    const lowerCaseSearchTerm = searchTerm.toLowerCase();

    return notes
      .filter((note) => {
        // Bin View
        if (selectedTag === "bin") {
          return note.isDeleted && (
            note.title.toLowerCase().includes(lowerCaseSearchTerm) ||
            note.content.toLowerCase().includes(lowerCaseSearchTerm)
          );
        }

        // Hide deleted notes in other views
        if (note.isDeleted) return false;

        const matchesSearch =
          note.title.toLowerCase().includes(lowerCaseSearchTerm) ||
          note.tags.some((tag) => tag.toLowerCase().includes(lowerCaseSearchTerm)) ||
          note.content.toLowerCase().includes(lowerCaseSearchTerm);

        if (isArchiveView) {
          return note.isArchived && matchesSearch;
        }

        const matchesTag = selectedTag ? note.tags.includes(selectedTag) : true;
        // Hide archived notes in main view and tag views
        return !note.isArchived && matchesSearch && matchesTag;
      })
      .sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return b.updatedAt - a.updatedAt; // Sort by most recently updated
      });
  }, [notes, searchTerm, selectedTag]);

  const handleNewTextNote = () => {
    // New note implicitly Text mode, content empty
    setEditingNote(undefined);
    setShouldAutoFocus(true);
    setIsEditorOpen(true);
  };

  const handleNewListNote = () => {
    // We want to initialize the editor in Checklist mode.
    // The Editor component detects checklist mode by content content.
    // So we pass a dummy checklist item to start?
    // Or we rely on Editor's internal state?
    // Editor uses `initialNote?.content` to decide.
    // If I pass `undefined` (new note), Editor defaults to empty text.
    // I should pass an empty checklist string "- [ ] " to start in list mode?
    // Or just let user can switch.
    // User expects "New List Note" to open in List Mode.
    // Let's seed it.
    const newNoteSkeleton = {
      id: crypto.randomUUID(),
      title: "",
      content: "- [ ] ", // Seed with one empty item triggers list mode in Editor
      tags: [],
      isPinned: false,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    setEditingNote(newNoteSkeleton);
    setShouldAutoFocus(true);
    setIsEditorOpen(true);
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
        const updated = { ...note, isArchived: true, updatedAt: now };
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

  const handleBulkUnarchive = async () => {
    const selectedNotes = notes.filter(n => selectedNoteIds.has(n.id));
    if (selectedNotes.length === 0) return;

    const now = Date.now();
    const updates: Note[] = [];

    const newNotes = notes.map(note => {
      if (selectedNoteIds.has(note.id)) {
        const updated = { ...note, isArchived: false, updatedAt: now };
        updates.push(updated);
        return updated;
      }
      return note;
    });

    setNotes(newNotes);
    await Promise.all(updates.map(n => saveNote(n)));

    handleClearSelection();
    showSuccess("Notes unarchived");
  };

  const handleBulkDelete = async () => {
    const selectedNotes = notes.filter(n => selectedNoteIds.has(n.id));
    if (selectedNotes.length === 0) return;

    const isBinView = selectedTag === "bin";
    const now = Date.now();

    if (isBinView) {
      // Hard delete
      const idsToDelete = Array.from(selectedNoteIds);
      
      await Promise.all(selectedNotes.map(async n => {
        if (n.images && n.images.length > 0) {
          await Promise.all(n.images.map(deleteImage));
        }
        await deleteNote(n.id);
      }));

      setNotes((prevNotes) => prevNotes.filter(note => !selectedNoteIds.has(note.id)));
      showSuccess("Notes permanently deleted");
    } else {
      // Soft delete
      const updates: Note[] = [];
      const newNotes = notes.map(note => {
        if (selectedNoteIds.has(note.id)) {
          const updated = {
            ...note,
            isDeleted: true,
            deletedAt: Date.now(),
            isPinned: false,
            updatedAt: Math.max(Date.now(), note.updatedAt + 1)
          };
          updates.push(updated);
          return updated;
        }
        return note;
      });

      setNotes(newNotes);
      await Promise.all(updates.map(n => saveNote(n)));
      showSuccess("Notes moved to Bin");
    }

    handleClearSelection();
  };

  const handleBulkRestore = async () => {
    const selectedNotes = notes.filter(n => selectedNoteIds.has(n.id));
    if (selectedNotes.length === 0) return;

    const now = Date.now();
    const updates: Note[] = [];
    const newNotes = notes.map(note => {
      if (selectedNoteIds.has(note.id)) {
        const updated = {
          ...note,
          isDeleted: false,
          deletedAt: undefined,
          updatedAt: now
        };
        updates.push(updated);
        return updated;
      }
      return note;
    });

    setNotes(newNotes);
    await Promise.all(updates.map(n => saveNote(n)));
    showSuccess("Notes restored");
    handleClearSelection();
  };

  const handleBulkExport = async () => {
    const zip = new JSZip();
    const selectedNotes = notes.filter((n) => selectedNoteIds.has(n.id));

    // Support exporting images async
    await Promise.all(selectedNotes.map(async (note) => {
      // Content is already markdown
      const content = note.content;

      // Sanitize title for filename
      const safeTitle = note.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50) || 'untitled';
      const filename = `${safeTitle}_${note.id.substring(0, 4)}.md`;
      
      zip.file(filename, `# ${note.title}\n\n${content}`);

      if (note.images && note.images.length > 0) {
        const imgFolder = zip.folder(`${safeTitle}_images`);
        if (imgFolder) {
          for (const imgPath of note.images) {
            try {
              const { data } = await Filesystem.readFile({ path: imgPath, directory: Directory.Data });
              imgFolder.file(imgPath.split('/').pop() || 'image.jpg', data, { base64: true });
            } catch (e) {
              console.warn("Failed to export image", imgPath);
            }
          }
        }
      }
    }));

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

  const handleRenameTag = async (oldTag: string, newTag: string) => {
    if (oldTag === newTag) return;

    // Update custom tags if necessary
    setCustomTags(prev => {
      const newTags = prev.map(t => t === oldTag ? newTag : t);
      // Deduplicate
      return Array.from(new Set(newTags));
    });

    // Check if newTag already exists (merge case) or just rename.
    // If newTag exists, we merge oldTag into newTag.

    const now = Date.now();
    const updates: Note[] = [];

    const newNotes = notes.map(note => {
      if (note.tags.includes(oldTag)) {
        let newTags = note.tags.map(t => t === oldTag ? newTag : t);
        // Deduplicate in case merge happen
        newTags = Array.from(new Set(newTags));

        const updated = { ...note, tags: newTags, updatedAt: now };
        updates.push(updated);
        return updated;
      }
      return note;
    });

    setNotes(newNotes);
    await Promise.all(updates.map(n => saveNote(n)));

    // NOTE: If we want to support updating the URL if the user is currently viewing the old tag:
    // But we don't have setSearchParams extracted here. 
    // Usually standard React Router pattern.
  };

  const handleDeleteTag = async (tagToDelete: string) => {
    // Remove from custom tags
    setCustomTags(prev => prev.filter(t => t !== tagToDelete));

    const now = Date.now();
    const updates: Note[] = [];

    const newNotes = notes.map(note => {
      if (note.tags.includes(tagToDelete)) {
        const newTags = note.tags.filter(t => t !== tagToDelete);
        const updated = { ...note, tags: newTags, updatedAt: now };
        updates.push(updated);
        return updated;
      }
      return note;
    });

    setNotes(newNotes);
    await Promise.all(updates.map(n => saveNote(n)));
  };

  const handleCreateTag = (tag: string) => {
    if (!tag.trim()) return;

    // Check if it already exists
    if (uniqueTags.includes(tag)) {
      showSuccess(`Label "${tag}" already exists`);
      return;
    }

    setCustomTags(prev => [...prev, tag]);
    showSuccess(`Label "${tag}" created`);
  };

  const mainContent = (
    <div
      className="flex flex-col flex-1 h-full min-h-0"
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

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-6 md:px-8 md:pb-8 md:pt-8"
      >
        {selectedTag === "bin" && (
          <div className="text-center italic text-muted-foreground mb-4">
            Notes in the bin will be deleted after 30 days.
          </div>
        )}
        <div
          className="pt-4 w-full"
          style={{
            columnCount: 2,
            columnGap: isMobile ? "0.5rem" : "1rem",
            columnWidth: "auto",
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
              onRestore={handleRestoreNote}
              onToggleListItem={handleToggleListItem}
              isSelected={selectedNoteIds.has(note.id)}
              isSelectionMode={isSelectionMode}
              onSelect={handleSelectNote}
            />
          ))}
        </div>
      </div>

      <NoteEditor
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSave={handleSaveNote}
        onDelete={handleDeleteNote}
        initialNote={editingNote}
        availableTags={uniqueTags}
        autoFocus={shouldAutoFocus}
      />

      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        notes={notes}
        onImportNotes={async (importedNotes) => {
          setNotes((prev) => [...importedNotes, ...prev]);
          // Save incrementally to prevent overwhelming the Capacitor SQLite plugin bridge
          for (const note of importedNotes) {
            await saveNote(note);
          }
        }}
      />

      <EditLabels
        isOpen={isEditLabelsOpen}
        onClose={() => setIsEditLabelsOpen(false)}
        tags={uniqueTags}
        onCreateTag={handleCreateTag}
        onRenameTag={handleRenameTag}
        onDeleteTag={handleDeleteTag}
      />

      {/* InitialAskToMigrate disabled â€” kept for future use */}
      {/* <InitialAskToMigrate
        isOpen={showInitialMigrationAsk}
        onAccept={() => {
          localStorage.setItem('has_seen_keep_migration_prompt', 'true');
          setShowInitialMigrationAsk(false);
          setShowMigrationGuide(true);
        }}
        onDecline={() => {
          localStorage.setItem('has_seen_keep_migration_prompt', 'true');
          setShowInitialMigrationAsk(false);
        }}
      /> */}

      <InitialEarlyAccessDialog
        isOpen={showEarlyAccessDialog}
        onClose={() => {
          localStorage.setItem('has_seen_early_access_dialog_v1', 'true');
          setShowEarlyAccessDialog(false);
        }}
      />

      <GoogleKeepMigrationGuide
        isOpen={showMigrationGuide}
        onClose={() => setShowMigrationGuide(false)}
      />
    </div >
  );

  const topBarStartAdornment = (
    <div className="flex items-center">
      {isMobile ? (
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="mr-2">
              <Menu className="h-6 w-6 text-muted-foreground" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0 bg-sidebar dark:bg-sidebar text-sidebar-foreground border-r-sidebar-border pt-[env(safe-area-inset-top)] flex flex-col">
            <div className="p-4 text-2xl font-bold text-sidebar-primary flex items-center shrink-0">
              <Lightbulb className="mr-2 h-6 w-6 text-yellow-500" fill="currentColor" />
              <span className="text-[hsl(218_4%_39%)] dark:text-[#e2e2e3]">Keep</span>
            </div>
            <SidebarNav
              uniqueTags={uniqueTags}
              onClose={() => setIsSheetOpen(false)}
              onEditLabels={() => setIsEditLabelsOpen(true)}
            />
          </SheetContent>
        </Sheet>
      ) : (
        <Button variant="ghost" size="icon" className="mr-2" onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}>
          <Menu className="h-6 w-6 text-muted-foreground" />
        </Button>
      )}
      <div className="text-xl font-bold flex items-center">
        {getHeaderContent()}
      </div>
    </div>
  );

  return (
    <div
      className="h-screen flex flex-col bg-background dark:bg-background text-foreground overflow-hidden"
      onClick={handleBackgroundClick} // Handle click outside
    >
      <TopBar
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        onSettingsClick={() => setIsSettingsOpen(true)}
        startAdornment={topBarStartAdornment}
      />

      <div className="flex-1 flex overflow-hidden">
        <SelectionActionBar
          selectedCount={selectedNoteIds.size}
          onClearSelection={handleClearSelection}
          onPin={handleBulkPin}
          onArchive={handleBulkArchive}
          onDelete={handleBulkDelete}
          onRestore={handleBulkRestore}
          showRestore={selectedTag === "bin"}
          onUnarchive={handleBulkUnarchive}
          showUnarchive={selectedTag === "archive"}
          hideArchive={selectedTag === "archive" || selectedTag === "bin"}
          hidePin={selectedTag === "archive" || selectedTag === "bin"}
          onExport={handleBulkExport}
          availableTags={uniqueTags}
          tagStates={tagStates}
          onTagToggle={handleTagToggle}
        />

        <AddNoteOptions
          onNewTextNote={handleNewTextNote}
          onNewListNote={handleNewListNote}
        />

        {isMobile ? (
          mainContent
        ) : (
          <div className="flex flex-1 min-w-0">
            {!isSidebarCollapsed ? (
              <ResizablePanelGroup direction="horizontal" className="h-full">
                <ResizablePanel defaultSize={15} minSize={10} maxSize={25} className="bg-sidebar dark:bg-sidebar text-sidebar-foreground border-r-sidebar-border pt-4 flex flex-col">
                  <SidebarNav
                    uniqueTags={uniqueTags}
                    onEditLabels={() => setIsEditLabelsOpen(true)}
                  />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={85}>
                  {mainContent}
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <>
                {/* Mini Sidebar */}
                <div
                  className="relative z-20 flex-none bg-sidebar dark:bg-sidebar flex flex-col pt-4"
                  style={{ width: '60px' }}
                >
                  <div className="absolute top-0 left-0 h-full bg-sidebar dark:bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out overflow-hidden shadow-none hover:shadow-2xl flex flex-col z-30 group w-[60px] hover:w-64 pt-4">
                    <SidebarNav
                      uniqueTags={uniqueTags}
                      onEditLabels={() => setIsEditLabelsOpen(true)}
                    />
                  </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 min-w-0">
                  {mainContent}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Note } from "@/types/note";
import { loadNotes, saveNote as localSaveNote, deleteNote as localDeleteNote, getLegacyWebNotes, migrateWebNotes, clearLegacyWebNotes, isWebReadFailed } from "@/lib/note-storage";
import { deleteImage } from "@/lib/image-storage";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
import NoteCard from "@/components/NoteCard";
import NoteEditor from "@/components/NoteEditor"; // Unified Editor
import { InlineNoteCreator } from "@/components/InlineNoteCreator";
import { useGoogleDrive, isGoogleDriveAuthBusy, isGoogleDriveScopeBlocked } from "@/hooks/use-google-drive";
import { useOneDrive } from "@/hooks/use-one-drive";
import { useDropbox } from "@/hooks/use-dropbox";
import { Loader2 } from "lucide-react";
import SidebarNav from "@/components/SidebarNav";
import SettingsDialog from "@/components/SettingsDialog";
import EditLabels from "@/components/EditLabels";
import AddNoteOptions from "@/components/AddNoteOptions";
import InitialAskToMigrate from "@/components/InitialAskToMigrate";
import WelcomeMessage from "@/components/WelcomeMessage";
import GoogleKeepMigrationGuide from "@/components/GoogleKeepMigrationGuide";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, safeRandomUUID } from "@/lib/utils";
import { Menu, Lightbulb, Settings } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import TopBar from "@/components/TopBar";
import { useSession } from '@/context/session-provider';
import { BulbIcon } from "@/components/BulbIcon";

import { showSuccess, showError } from "@/utils/toast";
import { SelectionActionBar } from "@/components/SelectionActionBar";
import FileInfo from "@/components/FileInfo";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { toggleCheckboxInContent } from "@/utils/markdown";
import { serializeNoteToMarkdown } from "@/utils/note-markdown-format";
import { rescheduleAllReminders } from "@/utils/reminder";
import { App as CapacitorApp } from "@capacitor/app";
import { useWidgetDeepLink } from "@/hooks/use-widget-deep-link";
import { useMcpBridge } from "@/hooks/use-mcp-bridge";

// How long a note sits in the Bin (isDeleted) before it's hard-removed, either
// by the auto-cleanup sweep below or by a manual "Delete Forever". Manual
// permanent delete is gated on this too -- hard-removing a note is a local-only
// operation with no tombstone, so deleting it before this device has had a
// chance to sync the soft-delete to every cloud-connected device risks a
// still-live remote copy getting merged back in on the next sync.
const BIN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// A corrupt or non-array "custom-tags" value used to white-screen the app: it
// was parsed unguarded both in the useState initialiser (crash on mount) and in
// the notes-updated handler (throws inside an event listener after every sync).
// Guard both through here. Note the Array.isArray check matters as much as the
// try/catch — JSON.parse("5") succeeds and returns a number, which then blows up
// on the first spread or .map.
const readCustomTags = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem("custom-tags") ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
};

const Index = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  // Starts true: Index now mounts BEFORE the database has been opened, so an empty
  // `notes` array means "not read yet", not "you have no notes". Rendering the real
  // empty state during this window would look identical to data loss.
  const [isLoading, setIsLoading] = useState(true);
  const [dbUnavailable, setDbUnavailable] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [shouldAutoFocus, setShouldAutoFocus] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchParams] = useSearchParams();
  const [selectedTag, setSelectedTag] = useState<string | null>(searchParams.get("tag"));
  const isMobile = useIsMobile();
  const [sortMode, setSortMode] = useState<"recent" | "alphabetical">("recent");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isEditLabelsOpen, setIsEditLabelsOpen] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [exitingNoteIds, setExitingNoteIds] = useState<Set<string>>(new Set());
  const [isFileInfoOpen, setIsFileInfoOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [customTags, setCustomTags] = useState<string[]>(readCustomTags);
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
  
    // Widget deep link handling — pending URL is kept until clearAction().
        const { action: widgetAction, clearAction } = useWidgetDeepLink();
        const notesLoadedRef = useRef(false);

        useEffect(() => {
          if (!widgetAction) return;

          if (widgetAction.type === "new-text") {
            handleNewTextNote();
            clearAction();
            return;
          }

          if (widgetAction.type === "new-list") {
            handleNewListNote();
            clearAction();
            return;
          }

          if (widgetAction.type === "open-note") {
            // Wait until notes have loaded at least once before giving up.
            const note = notes.find((n) => n.id === widgetAction.noteId);
            if (note && !note.isDeleted) {
              handleEditNote(note);
              clearAction();
            } else if (notesLoadedRef.current) {
              clearAction();
            }
            return;
          }

          if (widgetAction.type === "toggle-checkbox") {
            handleToggleListItem(widgetAction.noteId, `line-${widgetAction.lineIndex}`);
            clearAction();
          }
        }, [widgetAction, notes]);

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
      !Capacitor.isNativePlatform() && (
        <div className="flex items-center">
          <BulbIcon className="mr-2 h-6 w-6 flex-shrink-0" />
          <span className="text-[hsl(218_4%_39%)] dark:text-[#e2e2e3]">Keep</span>
        </div>
      )
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

  // Auto-Sync Logic
  const autoSyncTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasInitialSynced = useRef(false);
  // DB writes started by saveNote/deleteNote that haven't settled yet. Lets the
  // editor-close sync wait for the editor's final save before uploading.
  const pendingWritesRef = useRef<Set<Promise<unknown>>>(new Set());

  // Pull the notes list back from the database, which is the source of truth.
  //
  // The app is not the only writer: the home-screen widgets and the MCP bridge
  // write straight to the same Room database while the app is backgrounded, so
  // `notes` in React state can be stale at any moment.
  const refreshNotesFromDb = useCallback(async () => {
    try {
      const reloadedNotes = await loadNotes();
      setNotes(reloadedNotes);
      setDbUnavailable(false);
    } catch (error) {
      console.error("Failed to reload notes from the database:", error);
      // Keep existing notes in state — don't clear them
      setDbUnavailable(true);
    }

    // Guard kept deliberately: when the key is absent (a reset flow removes it)
    // the previous behaviour was to leave in-memory tags alone, not clear them.
    if (localStorage.getItem("custom-tags") !== null) {
      setCustomTags(readCustomTags());
    }
  }, []);

  // Resolves true if a sync was attempted, false if it was skipped.
  const performAutoSync = useCallback(async (): Promise<boolean> => {
    if (!activeService) return false;
    if (activeService.isSyncing) return false;
    if (
      activeService.name === "Google Drive" &&
      (isGoogleDriveAuthBusy() || isGoogleDriveScopeBlocked())
    ) {
      console.log("Auto-sync: skipping Google Drive (auth in progress or scope blocked)");
      return false;
    }
    console.log("Auto-sync: performAutoSync started for", activeService.name);
    try {
      const syncResult = await activeService.sync(undefined, undefined, undefined, true);
      console.log("Auto-sync: result", syncResult);
      if (syncResult && syncResult.status === "success") {
        const loadedNotes = await loadNotes();
        setNotes(loadedNotes);
        // Silently succeeded
      } else if (syncResult && syncResult.status === "conflict") {
        window.dispatchEvent(new CustomEvent("open-sync-conflict", {
          detail: {
            service: activeService.name.toLowerCase().replace(" ", ""),
            payload: (syncResult as any).cloudPayload,
            reason: (syncResult as any).reason
          }
        }));
        setIsSettingsOpen(true);
      }
    } catch (error) {
      console.error("Auto-sync failed", error);
    }
    return true;
  }, [activeService]);

  const triggerEditAutoSync = useCallback(() => {
    if (!activeService) return;
    if (autoSyncTimerRef.current) {
      clearTimeout(autoSyncTimerRef.current);
    }
    autoSyncTimerRef.current = setTimeout(() => {
      // Null once fired, so a non-null ref always means "an edit is waiting to sync".
      autoSyncTimerRef.current = null;
      performAutoSync();
    }, 30000); // 30 seconds
  }, [activeService, performAutoSync]);

  const handleExportAllNotes = async () => {
    // Binned notes are excluded, matching handleBulkExport (whose selection can
    // only ever come from the non-binned list). Exporting them unmarked meant a
    // re-import silently resurrected deleted notes as live ones -- the frontmatter
    // carries no "deleted" flag, so nothing downstream could tell them apart.
    const exportableNotes = notes.filter((note) => !note.isDeleted);
    const binnedCount = notes.length - exportableNotes.length;

    if (exportableNotes.length === 0) {
      showError("No notes to export");
      return;
    }

    const zip = new JSZip();

    await Promise.all(exportableNotes.map(async (note) => {
      const safeTitle = note.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50) || 'untitled';
      const filename = `${safeTitle}_${note.id.substring(0, 4)}.md`;

      zip.file(filename, serializeNoteToMarkdown(note));

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
    // Say so rather than dropping them silently -- this path is reachable from the
    // storage-full toast, where the user is trying to rescue their data.
    showSuccess(
      binnedCount > 0
        ? `Exported all notes (${binnedCount} in the bin were not included)`
        : "Exported all notes"
    );
  };

  const persistNote = async (note: Note) => {
    try {
      const wasTrimmed = await localSaveNote(note);
      triggerEditAutoSync();
      return wasTrimmed;
    } catch (error) {
      console.error("Failed to save note:", error);
      if (error instanceof Error && error.message.includes("Browser storage is full")) {
        showError("Storage is full. Your change was not saved.", {
          action: {
            label: 'Export All',
            onClick: () => handleExportAllNotes()
          },
          duration: 10000
        });
      } else {
        showError("Failed to save note. Your change was not persisted.");
      }
      // Revert: reload notes from truth to undo optimistic UI
      try {
        const truthNotes = await loadNotes();
        setNotes(truthNotes);
      } catch {
        // DB is unavailable
        setDbUnavailable(true);
      }
    }
  };

  const persistDelete = async (id: string) => {
    try {
      await localDeleteNote(id);
      triggerEditAutoSync();
    } catch (error) {
      console.error("Failed to delete note:", error);
      showError("Failed to delete note.");
      // Revert: reload notes from truth
      try {
        const truthNotes = await loadNotes();
        setNotes(truthNotes);
      } catch {
        setDbUnavailable(true);
      }
    }
  };

  // Tracks the whole wrapper (write + triggerEditAutoSync), so once it settles
  // the 30s timer is already armed for that change.
  const trackWrite = <T,>(write: Promise<T>): Promise<T> => {
    const pending = pendingWritesRef.current;
    pending.add(write);
    const settle = () => { pending.delete(write); };
    write.then(settle, settle);
    return write;
  };

  const saveNote = (note: Note) => trackWrite(persistNote(note));
  const deleteNote = (id: string) => trackWrite(persistDelete(id));

  // Sync as soon as the editor closes (done, delete or archive), instead of
  // waiting out the 30s timer. Only when there's something to send: the timer
  // being armed means an edit hasn't synced yet, so just opening a note to read
  // it and closing it costs no network round-trip.
  const handleEditorClose = async () => {
    setIsEditorOpen(false);
    // NoteEditor calls onSave()/onDelete() and then onClose() in the same tick
    // without awaiting, so the final save may still be writing. Uploading now
    // would miss it.
    await Promise.allSettled([...pendingWritesRef.current]);
    if (!autoSyncTimerRef.current) return;
    clearTimeout(autoSyncTimerRef.current);
    autoSyncTimerRef.current = null;
    const attempted = await performAutoSync();
    // Skipped (a sync already running, or Drive auth busy): keep the 30s backstop
    // so the change isn't stranded until the next launch/resume.
    if (!attempted) triggerEditAutoSync();
  };

  // Auto-sync on App Launch
  useEffect(() => {
    if (activeService && !hasInitialSynced.current) {
      console.log("Auto-sync: App Launch triggered");
      hasInitialSynced.current = true;
      performAutoSync();
    }
  }, [activeService, performAutoSync]);

  // Reload on App Resume, then auto-sync if a cloud service is connected.
  //
  // The reload is deliberately NOT gated on `activeService`. It used to be, and
  // that was the bug: with no cloud provider connected nothing ever re-read the
  // database, so ticking a checkbox in a widget left the app showing the old
  // content, and the next in-app edit wrote that stale copy back over it — the
  // tick silently reverted. This is a row scan on an already-open Room instance
  // (~60ms), not the ~610ms SQLCipher open, which happens once at startup.
  //
  // Safe while the editor is open: NoteEditor only re-hydrates from `initialNote`
  // when it (re)opens or the note id changes, neither of which a setNotes() here
  // triggers, so in-progress edits are not clobbered.
  useEffect(() => {
    const setupResumeListener = async () => {
      const listener = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) return;
        void refreshNotesFromDb();
        if (activeService) {
          performAutoSync();
        }
      });
      return listener;
    };

    const listenerPromise = setupResumeListener();

    return () => {
      listenerPromise.then(listener => listener.remove());
    };
  }, [activeService, performAutoSync, refreshNotesFromDb]);

  // Warn before closing the tab/window if a cloud provider is connected and an
  // edit hasn't made it out yet — otherwise closing right after an edit can
  // silently drop it before the 30s debounce timer (or an in-flight upload)
  // gets to run. Native builds don't get "closed" this way, so skip there.
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    if (!activeService) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const hasUnsyncedEdits =
        autoSyncTimerRef.current !== null ||
        activeService.isSyncing ||
        pendingWritesRef.current.size > 0;
      if (!hasUnsyncedEdits) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [activeService]);

  const handleTouchStart = (e: React.TouchEvent) => {
    // Check if we are at the top of the scroll container
    if (activeService && (!scrollContainerRef.current || scrollContainerRef.current.scrollTop <= 1) && !isSelectionMode) {
      setPullStartPoint(e.targetTouches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (activeService && pullStartPoint > 0 && (!scrollContainerRef.current || scrollContainerRef.current.scrollTop <= 1) && !isSelectionMode) {
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
      try {
        // MIGRATION CHECK
        const MIGRATION_KEY = 'migrated_to_native_v1';
        const hasMigrated = localStorage.getItem(MIGRATION_KEY);

        if (!hasMigrated) {
          const legacyNotes = getLegacyWebNotes();
          if (legacyNotes.length > 0) {
            console.log("Migrating notes to native database...", legacyNotes.length);
            await migrateWebNotes(legacyNotes);
          }
          localStorage.setItem(MIGRATION_KEY, 'true');
        }

        const loadedNotes = await loadNotes();

        // Reschedule any pending reminders (isolated so one bad reminder doesn't blank the list)
        try {
          await rescheduleAllReminders(loadedNotes);
        } catch (reminderError) {
          console.error("Failed to reschedule reminders:", reminderError);
        }

        // AUTO-DELETE CLEANUP (30 days)
        const now = Date.now();
        const notesToPermanentlyDelete = loadedNotes.filter(n => n.isDeleted && n.deletedAt && (now - n.deletedAt > BIN_RETENTION_MS));

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
        setDbUnavailable(false);
      } catch (error) {
        console.error("Failed to load notes:", error);
        if (Capacitor.isNativePlatform()) {
          // This read is now what proves the stored encryption key works -- checkStatus
          // no longer opens the database. A failure here means a wrong key or an
          // unreadable DB, so hand back to the lock screen: exactly where a failed
          // checkStatus verification used to land the user. App.tsx listens for this.
          window.dispatchEvent(new CustomEvent("open-keep-db-unverified"));
        } else {
          setDbUnavailable(true);
        }
      } finally {
        notesLoadedRef.current = true;
        setIsLoading(false);
      }
    };

    initNotes();
  }, []);

  // Reload notes whenever cloud sync writes to the DB
  useEffect(() => {
    window.addEventListener("notes-updated", refreshNotesFromDb);
    return () => window.removeEventListener("notes-updated", refreshNotesFromDb);
  }, [refreshNotesFromDb]);


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

  const handleSaveNote = async (noteToSave: Note): Promise<boolean> => {
    // `!isLoading` matters: during the initial open `notes` is [] but unread, and a user
    // fast enough to create a note in that window would otherwise trip the first-run branch.
    if (!isLoading && notes.length === 0 && !localStorage.getItem('has_seen_early_access_dialog_v1')) {
      if (!Capacitor.isNativePlatform()) {
        setShowEarlyAccessDialog(true);
        if (navigator.storage && navigator.storage.persist) {
          navigator.storage.persist().catch(console.error);
        }
      } else {
        localStorage.setItem('has_seen_early_access_dialog_v1', 'true');
      }
    }

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

    // Write to DB. Returns whether note-limits.ts trimmed the content, so
    // callers (e.g. the MCP bridge) can report that back instead of it
    // being silently invisible outside the Settings-import toast path.
    return await saveNote(noteToSave);
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

    setExitingNoteIds(prev => new Set(prev).add(id));

    const updatedNote = { ...note, isArchived: !note.isArchived, updatedAt: Date.now() };

    void saveNote(updatedNote);

    setTimeout(() => {
      setNotes((prevNotes) =>
        prevNotes.map((n) => (n.id === id ? updatedNote : n))
      );
      setExitingNoteIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (updatedNote.isArchived) {
        showSuccess("Note archived", {
          action: {
            label: "Undo",
            onClick: async () => {
              const restoredNote = { ...note, isArchived: false, updatedAt: Date.now() };
              setNotes((prevNotes) =>
                prevNotes.map((n) => (n.id === id ? restoredNote : n))
              );
              await saveNote(restoredNote);
            }
          }
        });
      } else {
        showSuccess("Note unarchived", {
          action: {
            label: "Undo",
            onClick: async () => {
              const restoredNote = { ...note, isArchived: true, updatedAt: Date.now() };
              setNotes((prevNotes) =>
                prevNotes.map((n) => (n.id === id ? restoredNote : n))
              );
              await saveNote(restoredNote);
            }
          }
        });
      }
    }, 320);
  };

  const handleDeleteNote = async (id: string) => {
    const note = notes.find((n) => n.id === id);
    if (!note) return;

    if (note.isDeleted && note.deletedAt && Date.now() - note.deletedAt < BIN_RETENTION_MS) {
      showError("Notes in the Bin are deleted automatically after 30 days.");
      return;
    }

    setExitingNoteIds(prev => new Set(prev).add(id));

    if (note.isDeleted) {
      // Permanent Delete
      if (note.images && note.images.length > 0) {
        await Promise.all(note.images.map(deleteImage));
      }
      void deleteNote(id);
      setTimeout(() => {
        setNotes((prevNotes) => prevNotes.filter((n) => n.id !== id));
        setExitingNoteIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        showSuccess("Note permanently deleted");
      }, 320);
    } else {
      // Soft Delete
      const updatedNote = {
        ...note,
        isDeleted: true,
        deletedAt: Date.now(),
        isPinned: false, // Unpin when deleting
        updatedAt: Math.max(Date.now(), note.updatedAt + 1)
      };

      void saveNote(updatedNote);
      setTimeout(() => {
        setNotes((prevNotes) =>
          prevNotes.map((n) => (n.id === id ? updatedNote : n))
        );
        setExitingNoteIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        showSuccess("Note moved to Bin", {
          action: {
            label: "Undo",
            onClick: async () => {
              const restoredNote: Note = {
                ...note,
                isDeleted: false,
                deletedAt: undefined,
                updatedAt: Date.now()
              };
              setNotes((prevNotes) =>
                prevNotes.map((n) => (n.id === id ? restoredNote : n))
              );
              await saveNote(restoredNote);
            }
          }
        });
      }, 320);
    }
  };

  const handleRestoreNote = async (id: string) => {
    const note = notes.find((n) => n.id === id);
    if (!note) return;

    setExitingNoteIds(prev => new Set(prev).add(id));

    const updatedNote = {
      ...note,
      isDeleted: false,
      deletedAt: undefined,
      updatedAt: Date.now()
    };

    void saveNote(updatedNote);
    setTimeout(() => {
      setNotes((prevNotes) =>
        prevNotes.map((n) => (n.id === id ? updatedNote : n))
      );
      setExitingNoteIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      showSuccess("Note restored");
    }, 320);
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

        if (sortMode === "alphabetical") {
          return a.title.localeCompare(b.title);
        }

        return b.updatedAt - a.updatedAt; // Sort by most recently updated
      });
  }, [notes, searchTerm, selectedTag, sortMode]);

  const { pinnedNotes, otherNotes } = useMemo(() => {
    const pinned: Note[] = [];
    const others: Note[] = [];
    for (const note of filteredNotes) {
      if (note.isPinned) {
        pinned.push(note);
      } else {
        others.push(note);
      }
    }
    return { pinnedNotes: pinned, otherNotes: others };
  }, [filteredNotes]);

  const showPinnedSections = pinnedNotes.length > 0 && selectedTag !== "archive" && selectedTag !== "bin";

  const handleNewTextNote = () => {
    const newNoteSkeleton: Note = {
      id: safeRandomUUID(),
      title: "",
      content: "",
      type: "text",
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
    const newNoteSkeleton: Note = {
      id: safeRandomUUID(),
      title: "",
      content: "- [ ] ", // Seed with one empty item triggers list mode in Editor
      type: "list",
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

    const ids = Array.from(selectedNoteIds);
    const archivedSnapshot = [...selectedNotes];
    setExitingNoteIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });

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

    handleClearSelection();
    void Promise.all(updates.map(n => saveNote(n)));

    setTimeout(() => {
      setNotes(newNotes);
      setExitingNoteIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
      showSuccess(selectedNotes.length === 1 ? "Note archived" : `${selectedNotes.length} notes archived`, {
        action: {
          label: "Undo",
          onClick: async () => {
            const undoTime = Date.now();
            const restoredNotes = archivedSnapshot.map(n => ({
              ...n,
              isArchived: false,
              updatedAt: undoTime
            }));
            const restoredMap = new Map(restoredNotes.map(n => [n.id, n]));
            setNotes((prevNotes) =>
              prevNotes.map((n) => restoredMap.get(n.id) || n)
            );
            await Promise.all(restoredNotes.map(n => saveNote(n)));
          }
        }
      });
    }, 320);
  };

  const handleBulkUnarchive = async () => {
    const selectedNotes = notes.filter(n => selectedNoteIds.has(n.id));
    if (selectedNotes.length === 0) return;

    const ids = Array.from(selectedNoteIds);
    const unarchivedSnapshot = [...selectedNotes];
    setExitingNoteIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });

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

    handleClearSelection();
    void Promise.all(updates.map(n => saveNote(n)));

    setTimeout(() => {
      setNotes(newNotes);
      setExitingNoteIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
      showSuccess(selectedNotes.length === 1 ? "Note unarchived" : `${selectedNotes.length} notes unarchived`, {
        action: {
          label: "Undo",
          onClick: async () => {
            const undoTime = Date.now();
            const restoredNotes = unarchivedSnapshot.map(n => ({
              ...n,
              isArchived: true,
              updatedAt: undoTime
            }));
            const restoredMap = new Map(restoredNotes.map(n => [n.id, n]));
            setNotes((prevNotes) =>
              prevNotes.map((n) => restoredMap.get(n.id) || n)
            );
            await Promise.all(restoredNotes.map(n => saveNote(n)));
          }
        }
      });
    }, 320);
  };

  const handleBulkDelete = async () => {
    const selectedNotes = notes.filter(n => selectedNoteIds.has(n.id));
    if (selectedNotes.length === 0) return;

    const isBinView = selectedTag === "bin";
    const now = Date.now();

    if (isBinView) {
      // Only hard-delete notes that have been in the Bin long enough for the
      // soft-delete to have synced everywhere; see BIN_RETENTION_MS.
      const eligibleNotes = selectedNotes.filter(n => !n.deletedAt || now - n.deletedAt >= BIN_RETENTION_MS);
      const blockedCount = selectedNotes.length - eligibleNotes.length;
      const eligibleIds = eligibleNotes.map(n => n.id);

      handleClearSelection();

      if (eligibleIds.length > 0) {
        setExitingNoteIds(prev => {
          const next = new Set(prev);
          eligibleIds.forEach(id => next.add(id));
          return next;
        });

        void Promise.all(eligibleNotes.map(async n => {
          if (n.images && n.images.length > 0) {
            await Promise.all(n.images.map(deleteImage));
          }
          await deleteNote(n.id);
        }));

        setTimeout(() => {
          setNotes((prevNotes) => prevNotes.filter(note => !eligibleIds.includes(note.id)));
          setExitingNoteIds(prev => {
            const next = new Set(prev);
            eligibleIds.forEach(id => next.delete(id));
            return next;
          });
          showSuccess(eligibleIds.length === 1 ? "Note permanently deleted" : "Notes permanently deleted");
        }, 320);
      }

      if (blockedCount > 0) {
        showError(`${blockedCount} note${blockedCount === 1 ? "" : "s"} can't be deleted yet — the Bin removes notes automatically after 30 days.`);
      }
    } else {
      const ids = Array.from(selectedNoteIds);
      setExitingNoteIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.add(id));
        return next;
      });

      const updates: Note[] = [];
      const deletedSnapshot = [...selectedNotes];
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

      handleClearSelection();
      void Promise.all(updates.map(n => saveNote(n)));

      setTimeout(() => {
        setNotes(newNotes);
        setExitingNoteIds(prev => {
          const next = new Set(prev);
          ids.forEach(id => next.delete(id));
          return next;
        });
        showSuccess(selectedNotes.length === 1 ? "Note moved to Bin" : `${selectedNotes.length} notes moved to Bin`, {
          action: {
            label: "Undo",
            onClick: async () => {
              const undoTime = Date.now();
              const restoredNotes = deletedSnapshot.map(n => ({
                ...n,
                isDeleted: false,
                deletedAt: undefined,
                updatedAt: undoTime
              }));
              const restoredMap = new Map(restoredNotes.map(n => [n.id, n]));
              setNotes((prevNotes) =>
                prevNotes.map((n) => restoredMap.get(n.id) || n)
              );
              await Promise.all(restoredNotes.map(n => saveNote(n)));
            }
          }
        });
      }, 320);
    }
  };

  const handleBulkRestore = async () => {
    const selectedNotes = notes.filter(n => selectedNoteIds.has(n.id));
    if (selectedNotes.length === 0) return;

    const ids = Array.from(selectedNoteIds);
    setExitingNoteIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });

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

    handleClearSelection();
    void Promise.all(updates.map(n => saveNote(n)));

    setTimeout(() => {
      setNotes(newNotes);
      setExitingNoteIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
      showSuccess("Notes restored");
    }, 320);
  };

  const handleBulkExport = async () => {
    const zip = new JSZip();
    const selectedNotes = notes.filter((n) => selectedNoteIds.has(n.id));

    // Support exporting images async
    await Promise.all(selectedNotes.map(async (note) => {

      // Sanitize title for filename
      const safeTitle = note.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50) || 'untitled';
      const filename = `${safeTitle}_${note.id.substring(0, 4)}.md`;

      zip.file(filename, serializeNoteToMarkdown(note));

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

  // Open Keep MCP Bridge -- lets a paired AI tool read/search/create/edit
  // notes while this tab is open. Off by default; see the "Open Keep MCP
  // Bridge" PRD for the full design. Deliberately reuses handleSaveNote,
  // handleRenameTag and handleDeleteTag rather than talking to note storage
  // directly, so it can never do anything the app's own UI couldn't.
  const aiBridge = useMcpBridge({ notes, handleSaveNote, handleRenameTag, handleDeleteTag });

  const mainContent = (
    <div
      className="flex flex-col flex-1 h-full min-h-0"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        transform: `translateY(${pullChange > 0 ? pullChange : 0}px)`,
        transition: isRefreshing ? 'transform 0.2s ease-out' : pullChange === 0 ? 'transform 0.3s ease-out' : 'none',
        willChange: pullChange > 0 || isRefreshing ? 'transform' : 'auto',
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
        {dbUnavailable && isWebReadFailed() && (
          <div className="bg-destructive/15 border border-destructive/30 rounded-lg p-4 mb-4 text-sm text-destructive dark:text-red-400">
            <p className="font-semibold mb-1">Local notes storage is unreadable</p>
            <p>Your notes could not be loaded. A backup of the corrupt data has been quarantined.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 bg-background"
              onClick={() => {
                const data = localStorage.getItem("open-keep-notes-corrupt");
                if (data) {
                  const blob = new Blob([data], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "corrupt-notes-backup.txt";
                  a.click();
                  URL.revokeObjectURL(url);
                }
              }}
            >
              Download backup copy
            </Button>
          </div>
        )}
        {dbUnavailable && !isWebReadFailed() && (
          <div className="bg-destructive/15 border border-destructive/30 rounded-lg p-4 mb-4 text-sm text-destructive dark:text-red-400">
            <p className="font-semibold mb-1">Unable to read notes</p>
            <p>Your notes have not been deleted. Cloud sync is paused. Please restart the app. Do not use &quot;Reset&quot; or &quot;Forgot PIN&quot;.</p>
          </div>
        )}
        {selectedTag === "bin" && (
          <div className="text-center italic text-muted-foreground mb-4">
            Notes in the bin will be deleted after 30 days.
          </div>
        )}

        {!isMobile && selectedTag !== "bin" && selectedTag !== "archive" && !searchTerm && (
          <InlineNoteCreator
            onSaveNote={handleSaveNote}
            availableTags={uniqueTags}
            defaultTag={selectedTag && selectedTag !== "bin" && selectedTag !== "archive" ? selectedTag : undefined}
            onCreateTag={handleCreateTag}
          />
        )}

        {isLoading && (
          <div
            aria-hidden="true"
            className={cn(
              "pt-4 w-full",
              viewMode === "grid"
                ? "columns-2 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5"
                : "flex flex-col space-y-4"
            )}
            style={viewMode === "grid" ? {
              columnGap: isMobile ? "0.5rem" : "1rem",
            } : undefined}
          >
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="mb-2 sm:mb-4 break-inside-avoid rounded-lg border border-border bg-card p-4"
              >
                <Skeleton className="h-4 w-2/3 mb-3" />
                <Skeleton className="h-3 w-full mb-2" />
                <Skeleton className={cn("h-3 mb-2", i % 2 === 0 ? "w-5/6" : "w-3/5")} />
                {i % 3 === 0 && <Skeleton className="h-3 w-4/5" />}
              </div>
            ))}
          </div>
        )}
        {!isLoading && showPinnedSections ? (
          <div className="pt-4 space-y-6 w-full">
            {pinnedNotes.length > 0 && (
              <section aria-label="Pinned notes">
                <h2 className="text-[11px] font-medium tracking-wider uppercase text-muted-foreground px-2 mb-2 select-none">
                  PINNED
                </h2>
                <div
                  className={cn(
                    "w-full",
                    viewMode === "grid"
                      ? "columns-2 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5"
                      : "flex flex-col space-y-4"
                  )}
                  style={viewMode === "grid" ? {
                    columnGap: isMobile ? "0.5rem" : "1rem",
                  } : undefined}
                >
                  {pinnedNotes.map((note) => (
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
                      isExiting={exitingNoteIds.has(note.id)}
                    />
                  ))}
                </div>
              </section>
            )}
            {otherNotes.length > 0 && (
              <section aria-label="Other notes">
                <h2 className="text-[11px] font-medium tracking-wider uppercase text-muted-foreground px-2 mb-2 select-none">
                  OTHERS
                </h2>
                <div
                  className={cn(
                    "w-full",
                    viewMode === "grid"
                      ? "columns-2 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5"
                      : "flex flex-col space-y-4"
                  )}
                  style={viewMode === "grid" ? {
                    columnGap: isMobile ? "0.5rem" : "1rem",
                  } : undefined}
                >
                  {otherNotes.map((note) => (
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
                      isExiting={exitingNoteIds.has(note.id)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div
            className={cn(
              "pt-4 w-full",
              viewMode === "grid"
                ? "columns-2 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5"
                : "flex flex-col space-y-4"
            )}
            style={viewMode === "grid" ? {
              columnGap: isMobile ? "0.5rem" : "1rem",
            } : undefined}
          >
            {!isLoading && filteredNotes.map((note) => (
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
                isExiting={exitingNoteIds.has(note.id)}
              />
            ))}
          </div>
        )}
      </div>

      <NoteEditor
        isOpen={isEditorOpen}
        onClose={() => { void handleEditorClose(); }}
        onSave={handleSaveNote}
        onDelete={handleDeleteNote}
        initialNote={editingNote}
        availableTags={uniqueTags}
        autoFocus={shouldAutoFocus}
        focusTarget={(localStorage.getItem("default-typing-area") as "title" | "body") || "body"}
      />

      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        notes={notes}
        aiBridge={aiBridge}
        onImportNotes={async (importedNotes) => {
          let anyTrimmed = false;
          setNotes((prev) => [...importedNotes, ...prev]);
          // Save incrementally to prevent overwhelming the Capacitor SQLite plugin bridge
          for (const note of importedNotes) {
            const wasTrimmed = await saveNote(note);
            if (wasTrimmed) anyTrimmed = true;
          }
          if (anyTrimmed) {
            showSuccess("Imported notes were trimmed to fit length limits.");
            // Reload notes to reflect trimmed state
            try {
              const truthNotes = await loadNotes();
              setNotes(truthNotes);
            } catch (error) {
              console.error("Failed to reload notes after import:", error);
            }
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

      <WelcomeMessage
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
        sortMode={sortMode}
        onSortModeChange={setSortMode}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
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
          onFileInfo={selectedNoteIds.size === 1 ? () => setIsFileInfoOpen(true) : undefined}
          availableTags={uniqueTags}
          tagStates={tagStates}
          onTagToggle={handleTagToggle}
        />

        {isFileInfoOpen && selectedNoteIds.size === 1 && (() => {
          const singleNote = notes.find(n => selectedNoteIds.has(n.id));
          return singleNote ? (
            <FileInfo
              isOpen={isFileInfoOpen}
              onClose={() => setIsFileInfoOpen(false)}
              note={singleNote}
            />
          ) : null;
        })()}

        <AddNoteOptions
          onNewTextNote={handleNewTextNote}
          onNewListNote={handleNewListNote}
        />

        {isMobile ? (
          mainContent
        ) : (
          <div className="flex flex-1 min-w-0">
            {!isSidebarCollapsed ? (
              <ResizablePanelGroup direction="horizontal" className="h-full" autoSaveId="openkeep-sidebar">
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
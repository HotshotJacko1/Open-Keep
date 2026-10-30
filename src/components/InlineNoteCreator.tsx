// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useRef, useEffect, useCallback } from "react";
import { Note } from "@/types/note";
import { cn, safeRandomUUID } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Pin,
  SquareCheck,
  Palette,
  Bell,
  Archive,
  ListChecks,
  Tag,
  Type,
  Bold,
  Italic,
  Underline,
  X,
  ImageIcon,
} from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import {
  CustomLink,
  HardBreakOnEnter,
  LINK_OPTIONS,
} from "@/lib/editor-extensions";
import NoteColorPicker from "@/components/NoteColorPicker";
import ReminderSheet from "@/components/ReminderSheet";
import NoteLabels from "@/components/NoteLabels";
import { ChecklistEditor } from "@/components/ChecklistEditor";
import {
  isTopLevel,
  parseChecklist,
  serializeChecklist,
  convertTextToList,
  convertListToText,
  ChecklistItem,
} from "@/utils/markdown";
import {
  htmlToPlainText,
  plainTextToHtml,
} from "@/utils/note-markdown-format";
import {
  DEFAULT_NOTE_COLOR,
  getNoteTintVars,
  isNoteTinted,
  normalizeNoteColor,
} from "@/lib/note-colors";
import {
  scheduleReminderNotification,
  formatReminderLabel,
} from "@/utils/reminder";
import { saveImage, getImageSrc, deleteImage } from "@/lib/image-storage";
import { expectExternalActivity } from "@/lib/app-relock";
import { TITLE_MAX, BODY_MAX } from "@/lib/note-limits";

interface InlineNoteCreatorProps {
  onSaveNote: (note: Note) => Promise<boolean> | void;
  availableTags: string[];
  defaultTag?: string;
  onCreateTag?: (tag: string) => void;
}

const newEmptyItem = (): ChecklistItem => ({
  id: safeRandomUUID(),
  content: "",
  checked: false,
  indentation: "",
});

// Empty items are left out of the saved note. Sub-items of an empty top-level
// item become top-level, as they do when that item is deleted with Backspace.
const withoutEmptyItems = (items: ChecklistItem[]): ChecklistItem[] => {
  const kept: ChecklistItem[] = [];
  let parentDropped = false;
  for (const item of items) {
    if (isTopLevel(item)) parentDropped = false;
    if (item.content.trim() === "") {
      if (isTopLevel(item)) parentDropped = true;
      continue;
    }
    kept.push(parentDropped ? { ...item, indentation: "" } : item);
  }
  return kept;
};

export const InlineNoteCreator: React.FC<InlineNoteCreatorProps> = ({
  onSaveNote,
  availableTags,
  defaultTag,
  onCreateTag,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isListMode, setIsListMode] = useState(false);

  // Form State
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [color, setColor] = useState<string>(DEFAULT_NOTE_COLOR);
  const [images, setImages] = useState<string[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [reminder, setReminder] = useState<number | undefined>(undefined);
  const [recurrence, setRecurrence] = useState<Note["recurrence"]>(undefined);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Checklist Items. A new list starts with one empty item, as in NoteEditor.
  const [items, setItems] = useState<ChecklistItem[]>(() => [newEmptyItem()]);
  // Non-item lines before the first item. Always empty here (nothing typed in
  // this creator produces them), but ChecklistEditor keeps them up to date.
  const leadingLinesRef = useRef<string[]>([]);
  const [showCompleted, setShowCompleted] = useState(true);
  // The item to focus when the list appears: set when opened with "New list".
  const [listFocusId, setListFocusId] = useState<string | undefined>(undefined);

  // Dialog & Popover visibility flags (to avoid closing inline creator on outside click)
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [isReminderOpen, setIsReminderOpen] = useState(false);
  const [isLabelsOpen, setIsLabelsOpen] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Body editor. Mirrors NoteEditor's configuration so notes created here and
  // notes edited there are the same HTML format — see @/lib/editor-extensions.
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Placeholder.configure({ placeholder: "Take a note..." }),
      CustomLink.configure(LINK_OPTIONS),
      CharacterCount.configure({ limit: BODY_MAX }),
      HardBreakOnEnter,
    ],
    content: body,
    editorProps: {
      attributes: {
        class:
          "auto-dir prose lg:prose-lg dark:prose-invert max-w-none focus:outline-none min-h-[40px] text-foreground",
      },
    },
    onUpdate: ({ editor }) => {
      setBody(editor.getHTML());
    },
  });

  // True when the editor holds no visible text (an empty editor still
  // serialises to "<p></p>", so the HTML string can't be tested directly).
  const isBodyEmpty = useCallback(() => {
    if (editor) return editor.getText().trim().length === 0;
    return body.replace(/<[^>]*>/g, "").trim().length === 0;
  }, [editor, body]);

  // Reset default tag when changing or expanding
  useEffect(() => {
    if (defaultTag) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- re-applies defaultTag when it changes (intentional)
      setSelectedTags([defaultTag]);
    } else {
      setSelectedTags([]);
    }
  }, [defaultTag]);

  // Load preview URLs for uploaded images
  useEffect(() => {
    let isCancelled = false;
    const loadUrls = async () => {
      const urls: Record<string, string> = {};
      for (const imgPath of images) {
        try {
          urls[imgPath] = await getImageSrc(imgPath);
        } catch (err) {
          console.error("Failed to load image preview:", err);
        }
      }
      if (!isCancelled) {
        setImageUrls(urls);
      }
    };
    if (images.length > 0) {
      loadUrls();
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears image URLs when images are removed; the other branch sets them async
      setImageUrls({});
    }
    return () => {
      isCancelled = true;
    };
  }, [images]);

  const hasContent = useCallback(() => {
    if (title.trim().length > 0) return true;
    if (images.length > 0) return true;
    if (isListMode) {
      return items.some((i) => i.content.trim().length > 0);
    }
    return !isBodyEmpty();
  }, [title, isBodyEmpty, images, isListMode, items]);

  // Set while a save-and-close is in flight or done, and cleared when the creator
  // is opened again (handleExpand). A second outside click or Escape before the
  // collapse has rendered still runs the old handler, with the old title and
  // body, and would save the note a second time under a new id (C2-39).
  const savingRef = useRef(false);

  const handleSaveAndClose = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;

    if (hasContent()) {
      let contentString: string;
      if (isListMode) {
        contentString = serializeChecklist(
          withoutEmptyItems(items),
          leadingLinesRef.current
        );
      } else {
        contentString = body.trim();
      }

      const newNote: Note = {
        id: safeRandomUUID(),
        title: title.trim(),
        content: contentString,
        type: isListMode ? "list" : "text",
        tags: selectedTags,
        isPinned,
        isArchived,
        color: normalizeNoteColor(color),
        images,
        reminder,
        recurrence,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      try {
        await onSaveNote(newNote);
      } catch (e) {
        // Nothing was saved and the form stays open, so let it be tried again.
        savingRef.current = false;
        throw e;
      }

      if (reminder) {
        try {
          await scheduleReminderNotification(newNote);
        } catch (e) {
          // The note is saved; a reminder failure mustn't leave the form open
          // with saving blocked by the guard above.
          console.error("Failed to schedule reminder:", e);
        }
      }
    }

    // Reset state
    setTitle("");
    setBody("");
    if (editor && !editor.isDestroyed) editor.commands.setContent("");
    setShowFormatting(false);
    setIsPinned(false);
    setIsArchived(false);
    setColor(DEFAULT_NOTE_COLOR);
    setImages([]);
    setReminder(undefined);
    setRecurrence(undefined);
    setSelectedTags(defaultTag ? [defaultTag] : []);
    setItems([newEmptyItem()]);
    leadingLinesRef.current = [];
    setListFocusId(undefined);
    setIsListMode(false);
    setIsExpanded(false);
  }, [
    hasContent,
    isListMode,
    items,
    body,
    title,
    selectedTags,
    isPinned,
    isArchived,
    color,
    images,
    reminder,
    recurrence,
    onSaveNote,
    defaultTag,
    editor,
  ]);

  // Handle click outside to auto-save and collapse
  useEffect(() => {
    if (!isExpanded) return;

    const handlePointerDown = (e: MouseEvent) => {
      // Don't close if any overlay dialog or popover is open
      if (isColorPickerOpen || isReminderOpen || isLabelsOpen) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // If clicked inside popovers or dialog portals, ignore
      if (
        target.closest("[role='dialog']") ||
        target.closest("[role='menu']") ||
        target.closest("[data-radix-popper-content-wrapper]")
      ) {
        return;
      }

      if (containerRef.current && !containerRef.current.contains(target)) {
        handleSaveAndClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!isColorPickerOpen && !isReminderOpen && !isLabelsOpen) {
          handleSaveAndClose();
        }
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    isExpanded,
    isColorPickerOpen,
    isReminderOpen,
    isLabelsOpen,
    handleSaveAndClose,
  ]);

  const handleExpand = (listMode: boolean) => {
    savingRef.current = false; // a fresh, empty form: saving is allowed again
    setIsListMode(listMode);
    // The list focuses this item itself when it appears.
    setListFocusId(listMode ? items[0]?.id : undefined);
    setIsExpanded(true);
    if (!listMode) {
      setTimeout(() => {
        if (editor && !editor.isDestroyed) editor.commands.focus("end");
      }, 50);
    }
  };

  // Image Upload Handlers
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    try {
      const imgPath = await saveImage(file);
      setImages((prev) => [...prev, imgPath]);
    } catch (err) {
      console.error("Failed to save image:", err);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveImage = async (path: string) => {
    setImages((prev) => prev.filter((p) => p !== path));
    try {
      await deleteImage(path);
    } catch (err) {
      console.error("Failed to delete image:", err);
    }
  };

  // Same conversions as NoteEditor's handleToggleMode.
  const handleToggleListMode = () => {
    if (!isListMode) {
      // Each paragraph of the body becomes an item.
      const { items: parsed, leading } = parseChecklist(
        convertTextToList(htmlToPlainText(body))
      );
      leadingLinesRef.current = leading;
      setItems(parsed.map((i) => ({ ...i, id: safeRandomUUID() })));
      setListFocusId(undefined);
      setIsListMode(true);
      setShowFormatting(false);
    } else {
      // Each item becomes a paragraph. Item text is plain, so it's escaped.
      const html = plainTextToHtml(
        convertListToText(
          serializeChecklist(withoutEmptyItems(items), leadingLinesRef.current)
        )
      );
      setBody(html);
      if (editor && !editor.isDestroyed) editor.commands.setContent(html);
      setIsListMode(false);
    }
  };

  // If collapsed: render Google Keep-style single-line input bar
  if (!isExpanded) {
    return (
      <div
        ref={containerRef}
        onClick={() => handleExpand(false)}
        className={cn(
          "press-feedback w-full max-w-[600px] mx-auto mb-6 cursor-text",
          "bg-card text-card-foreground border border-outline-variant shadow-elevation-1 rounded-card",
          "px-4 py-2.5 flex items-center justify-between gap-3 transition-shadow hover:shadow-elevation-2"
        )}
      >
        <span className="text-muted-foreground font-medium text-sm sm:text-base select-none">
          Take a note...
        </span>

        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  handleExpand(true);
                }}
              >
                <SquareCheck className="h-5 w-5" />
                <span className="sr-only">New list</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>New list</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  }

  // Expanded View
  return (
    <div
      ref={containerRef}
      style={getNoteTintVars(color) as React.CSSProperties}
      className={cn(
        "note-creator w-full max-w-[600px] mx-auto mb-6",
        isNoteTinted(color) && "note-tinted",
        "bg-card text-card-foreground border border-outline-variant shadow-elevation-2 rounded-card flex flex-col transition-colors duration-md3-short3 overflow-hidden"
      )}
    >
      {/* Hidden File Input for Images */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageSelect}
        accept="image/*"
        className="hidden"
      />

      {/* Image Attachments Header (if any) */}
      {images.length > 0 && (
        <div className="p-3 pb-0 flex flex-wrap gap-2">
          {images.map((img) => (
            <div
              key={img}
              className="relative group rounded-md overflow-hidden border border-border/50 max-h-40"
            >
              <img
                src={imageUrls[img] || ""}
                alt="Attachment"
                className="object-cover h-32 w-auto max-w-xs"
              />
              <button
                type="button"
                onClick={() => handleRemoveImage(img)}
                className="group/remove absolute top-0 right-0 h-12 w-12 flex items-start justify-end p-1"
              >
                <span className="bg-scrim/60 group-hover/remove:bg-scrim/80 text-on-scrim rounded-full p-1 opacity-80 group-hover:opacity-100 transition-[opacity,background-color]">
                  <X className="h-3.5 w-3.5" />
                </span>
                <span className="sr-only">Remove image</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Title & Pin Row */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1 gap-2">
        <input
          ref={titleInputRef}
          type="text"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          dir="auto"
          className="bg-transparent border-none outline-none focus:outline-none focus-visible:ring-0 text-text-primary dark:text-text-primary placeholder:text-muted-foreground text-base sm:text-lg font-semibold flex-1 min-w-0"
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setIsPinned(!isPinned)}
              className={isPinned ? "text-highlight" : "text-secondary"}
            >
              <Pin
                className={cn("h-5 w-5", isPinned && "fill-highlight")}
              />
              <span className="sr-only">
                {isPinned ? "Unpin note" : "Pin note"}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isPinned ? "Unpin note" : "Pin note"}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setIsReminderOpen(true)}
              className={reminder ? "text-highlight" : "text-secondary"}
            >
              <Bell
                className={cn("h-5 w-5", reminder && "fill-highlight")}
              />
              <span className="sr-only">Remind me</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Remind me</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setIsArchived(!isArchived)}
              className="text-secondary"
            >
              <Archive className="h-5 w-5" />
              <span className="sr-only">
                {isArchived ? "Unarchive" : "Archive"}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isArchived ? "Unarchive" : "Archive"}</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Main Content Area: Text or Checklist */}
      <div className="px-4 py-2">
        {!isListMode ? (
          <EditorContent editor={editor} className="w-full" />
        ) : (
          <ChecklistEditor
            // -mx-4 cancels this row's side padding so the 48px grip and remove
            // buttons sit at the edges, as in NoteEditor.
            className="-mx-4"
            items={items}
            onItemsChange={setItems}
            leadingLinesRef={leadingLinesRef}
            showChecked={showCompleted}
            onShowCheckedChange={setShowCompleted}
            initialFocusItemId={listFocusId}
          />
        )}
      </div>

      {/* Reminder & Label Chips (if any) */}
      {(reminder || selectedTags.length > 0) && (
        <div className="px-4 pb-2 flex flex-wrap items-center gap-1.5">
          {reminder && (
            <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground border border-border/50">
              <Bell className="h-3 w-3" />
              <span>{formatReminderLabel(reminder)}</span>
              <button
                type="button"
                onClick={() => {
                  setReminder(undefined);
                  setRecurrence(undefined);
                }}
                className="hover:text-text-primary ml-0.5"
              >
                <X className="h-3 w-3" />
                <span className="sr-only">Remove reminder</span>
              </button>
            </span>
          )}

          {selectedTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground border border-border/50"
            >
              <span dir="auto">{tag}</span>
              <button
                type="button"
                onClick={() =>
                  setSelectedTags((prev) => prev.filter((t) => t !== tag))
                }
                className="hover:text-text-primary ml-0.5"
              >
                <X className="h-3 w-3" />
                <span className="sr-only">Remove label</span>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Bottom Action Bar */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0">
        <div className="flex items-center gap-2">
          {/* Add Image */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => { expectExternalActivity(); fileInputRef.current?.click(); }}
                className="text-secondary"
              >
                <ImageIcon className="h-5 w-5" />
                <span className="sr-only">Add image</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Add image</p>
            </TooltipContent>
          </Tooltip>

          {/* Note Color Picker */}
          <Popover
            open={isColorPickerOpen}
            onOpenChange={setIsColorPickerOpen}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-secondary"
                  >
                    <Palette className="h-5 w-5" />
                    <span className="sr-only">Colour options</span>
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>Colour options</p>
              </TooltipContent>
            </Tooltip>
            <PopoverContent
              side="top"
              align="start"
              className="w-auto p-2 bg-popover text-popover-foreground border-border shadow-elevation-2"
            >
              <NoteColorPicker
                value={color}
                onChange={(c) => {
                  setColor(c);
                  setIsColorPickerOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>

          {/* Checkboxes Toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleToggleListMode}
                className="text-secondary"
              >
                <ListChecks className="h-5 w-5" />
                <span className="sr-only">
                  {isListMode ? "Hide checkboxes" : "Show checkboxes"}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isListMode ? "Hide checkboxes" : "Show checkboxes"}</p>
            </TooltipContent>
          </Tooltip>

          {/* Labels */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setIsLabelsOpen(true)}
                className="text-secondary"
              >
                <Tag className="h-5 w-5" />
                <span className="sr-only">Labels</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Labels</p>
            </TooltipContent>
          </Tooltip>

          {/* Formatting group: T toggle + B/I/U sub-buttons */}
          {/* Formatting is text-notes only — hidden entirely in checklist mode. */}
          {!isListMode && (
          <div className={cn("flex items-center gap-2 rounded-lg transition-colors", showFormatting && "bg-muted px-1")}>
          {/* Formatting Toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowFormatting(!showFormatting)}
                className={cn("text-secondary", showFormatting && "bg-brand-container text-brand-container-foreground")}
              >
                <Type className="h-5 w-5" />
                <span className="sr-only">Formatting</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Formatting</p>
            </TooltipContent>
          </Tooltip>

          {showFormatting && editor && !isListMode && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "text-secondary",
                      editor.isActive("bold") && "bg-brand-container text-brand-container-foreground"
                    )}
                    onClick={() => editor.chain().focus().toggleBold().run()}
                  >
                    <Bold className="h-4 w-4" />
                    <span className="sr-only">Bold</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Bold</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "text-secondary",
                      editor.isActive("italic") && "bg-brand-container text-brand-container-foreground"
                    )}
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                  >
                    <Italic className="h-4 w-4" />
                    <span className="sr-only">Italic</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Italic</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "text-secondary",
                      editor.isActive("underline") && "bg-brand-container text-brand-container-foreground"
                    )}
                    onClick={() =>
                      editor.chain().focus().toggleUnderline().run()
                    }
                  >
                    <Underline className="h-4 w-4" />
                    <span className="sr-only">Underline</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Underline</p>
                </TooltipContent>
              </Tooltip>
            </>
          )}
          </div>
          )}


        </div>

        {/* Close Button */}
        <Button
          type="button"
          variant="ghost"
          onClick={handleSaveAndClose}
          className="text-sm font-semibold px-4 py-1.5 hover:bg-muted/50 rounded text-text-primary hover:text-text-primary"
        >
          Close
        </Button>
      </div>

      {/* Reminder Sheet Modal */}
      <ReminderSheet
        isOpen={isReminderOpen}
        onClose={() => setIsReminderOpen(false)}
        currentReminder={reminder}
        currentRecurrence={recurrence}
        onSetReminder={(ts, rec) => {
          setReminder(ts);
          setRecurrence(rec);
          setIsReminderOpen(false);
        }}
        onRemoveReminder={() => {
          setReminder(undefined);
          setRecurrence(undefined);
          setIsReminderOpen(false);
        }}
      />

      {/* Labels Dialog */}
      <NoteLabels
        isOpen={isLabelsOpen}
        onClose={() => setIsLabelsOpen(false)}
        availableTags={availableTags}
        selectedTags={selectedTags.reduce(
          (acc, tag) => ({ ...acc, [tag]: true }),
          {}
        )}
        onTagToggle={(tag) => {
          setSelectedTags((prev) =>
            prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
          );
        }}
        onCreateTag={onCreateTag}
      />
    </div>
  );
};

// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useRef, useEffect, useCallback } from "react";
import { Note } from "@/types/note";
import { cn, safeRandomUUID } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  Plus,
  X,
  GripVertical,
  ChevronDown,
  ChevronRight,
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
import { TITLE_MAX, BODY_MAX, LIST_ITEM_MAX } from "@/lib/note-limits";

interface InlineChecklistItem {
  id: string;
  content: string;
  checked: boolean;
}

interface InlineNoteCreatorProps {
  onSaveNote: (note: Note) => Promise<boolean> | void;
  availableTags: string[];
  defaultTag?: string;
  onCreateTag?: (tag: string) => void;
}

// Turn the editor's HTML back into plain lines: paragraph, break and div
// boundaries are the line breaks, the rest is text content.
const htmlToLines = (html: string): string[] => {
  if (!html.includes("<")) return html.split("\n");
  const withBreaks = html
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n");
  const tmp = document.createElement("div");
  tmp.innerHTML = withBreaks;
  const text = tmp.textContent || tmp.innerText || "";
  return text.split("\n");
};

const escapeHtml = (text: string): string => {
  const tmp = document.createElement("div");
  tmp.textContent = text;
  return tmp.innerHTML;
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

  // Checklist Items
  const [items, setItems] = useState<InlineChecklistItem[]>([
    { id: safeRandomUUID(), content: "", checked: false },
  ]);
  const [showCompleted, setShowCompleted] = useState(true);

  // Dialog & Popover visibility flags (to avoid closing inline creator on outside click)
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [isReminderOpen, setIsReminderOpen] = useState(false);
  const [isLabelsOpen, setIsLabelsOpen] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const itemInputRefs = useRef<Record<string, HTMLInputElement>>({});

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
          "prose lg:prose-lg max-w-none focus:outline-none min-h-[40px] text-black dark:text-white",
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

  const handleSaveAndClose = useCallback(async () => {
    if (hasContent()) {
      let contentString = "";
      if (isListMode) {
        const nonEmptyItems = items.filter((i) => i.content.trim().length > 0);
        contentString = nonEmptyItems
          .map((i) => `- [${i.checked ? "x" : " "}] ${i.content.trim()}`)
          .join("\n");
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

      await onSaveNote(newNote);

      if (reminder) {
        await scheduleReminderNotification(newNote);
      }
    }

    // Reset state
    setTitle("");
    setBody("");
    editor?.commands.setContent("");
    setShowFormatting(false);
    setIsPinned(false);
    setIsArchived(false);
    setColor(DEFAULT_NOTE_COLOR);
    setImages([]);
    setReminder(undefined);
    setRecurrence(undefined);
    setSelectedTags(defaultTag ? [defaultTag] : []);
    setItems([{ id: safeRandomUUID(), content: "", checked: false }]);
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
    setIsListMode(listMode);
    setIsExpanded(true);
    setTimeout(() => {
      if (listMode) {
        const firstId = items[0]?.id;
        if (firstId && itemInputRefs.current[firstId]) {
          itemInputRefs.current[firstId]?.focus();
        } else {
          titleInputRef.current?.focus();
        }
      } else {
        editor?.commands.focus("end");
      }
    }, 50);
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

  // Checklist Helpers
  const handleUpdateItemContent = (id: string, content: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, content } : item))
    );
  };

  const handleToggleItemChecked = (id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item
      )
    );
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => {
      if (prev.length <= 1) {
        return [{ id: safeRandomUUID(), content: "", checked: false }];
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const handleItemKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    id: string,
    index: number
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const newId = safeRandomUUID();
      setItems((prev) => {
        const newItems = [...prev];
        newItems.splice(index + 1, 0, {
          id: newId,
          content: "",
          checked: false,
        });
        return newItems;
      });
      setTimeout(() => {
        itemInputRefs.current[newId]?.focus();
      }, 20);
    } else if (e.key === "Backspace") {
      const currentItem = items[index];
      if (currentItem && currentItem.content === "" && items.length > 1) {
        e.preventDefault();
        handleRemoveItem(id);
        const prevItem = items[index - 1] || items[index + 1];
        if (prevItem) {
          setTimeout(() => {
            itemInputRefs.current[prevItem.id]?.focus();
          }, 20);
        }
      }
    }
  };

  const handleAddNewItem = () => {
    const newId = safeRandomUUID();
    setItems((prev) => [
      ...prev,
      { id: newId, content: "", checked: false },
    ]);
    setTimeout(() => {
      itemInputRefs.current[newId]?.focus();
    }, 20);
  };

  const uncompletedItems = items.filter((i) => !i.checked);
  const completedItems = items.filter((i) => i.checked);

  const handleToggleListMode = () => {
    if (!isListMode) {
      // Convert body text to checklist items. The body is HTML, so paragraph
      // and break boundaries become the line breaks — same approach as
      // NoteEditor's handleToggleMode.
      const lines = htmlToLines(body).filter((l) => l.trim().length > 0);
      if (lines.length > 0) {
        setItems(
          lines.map((l) => ({
            id: safeRandomUUID(),
            content: l,
            checked: false,
          }))
        );
      }
      setIsListMode(true);
      setShowFormatting(false);
    } else {
      // Convert checklist items to body text
      const plain = items
        .map((i) => i.content)
        .filter((c) => c.trim().length > 0);
      // Wrap each line in <p> so TipTap keeps the line breaks.
      const html = plain.map((l) => `<p>${escapeHtml(l)}</p>`).join("");
      setBody(html);
      editor?.commands.setContent(html);
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
          "w-full max-w-[600px] mx-auto mb-6 cursor-text",
          "bg-card text-card-foreground border border-input shadow-md rounded-lg",
          "px-4 py-2.5 flex items-center justify-between gap-3 transition-shadow hover:shadow-lg"
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
        "bg-card text-card-foreground border border-input shadow-lg rounded-lg flex flex-col transition-colors duration-150 overflow-hidden"
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
                className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 opacity-80 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3.5 w-3.5" />
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
          className="bg-transparent border-none outline-none focus:outline-none focus-visible:ring-0 text-text-primary dark:text-text-primary placeholder:text-muted-foreground text-base sm:text-lg font-semibold flex-1 min-w-0"
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setIsPinned(!isPinned)}
              className={isPinned ? "text-yellow-400" : "text-secondary"}
            >
              <Pin
                className={cn("h-5 w-5", isPinned && "fill-yellow-400")}
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
              className={cn("text-secondary", reminder && "text-amber-500")}
            >
              <Bell className="h-5 w-5" />
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
          <div className="space-y-1">
            {/* Uncompleted Items */}
            {uncompletedItems.map((item, index) => (
              <div
                key={item.id}
                className="group flex items-center gap-2 py-1"
              >
                <GripVertical className="h-4 w-4 text-muted-foreground/60 shrink-0 cursor-grab" />
                <Checkbox
                  checked={item.checked}
                  onCheckedChange={() => handleToggleItemChecked(item.id)}
                  className="h-4 w-4 shrink-0 rounded border-gray-400"
                />
                <input
                  ref={(el) => {
                    if (el) itemInputRefs.current[item.id] = el;
                    else delete itemInputRefs.current[item.id];
                  }}
                  type="text"
                  value={item.content}
                  maxLength={LIST_ITEM_MAX}
                  onChange={(e) =>
                    handleUpdateItemContent(item.id, e.target.value)
                  }
                  onKeyDown={(e) => handleItemKeyDown(e, item.id, index)}
                  placeholder="List item"
                  className="bg-transparent border-none outline-none focus:outline-none focus-visible:ring-0 text-text-primary dark:text-text-primary placeholder:text-muted-foreground text-sm sm:text-base flex-1 min-w-0"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveItem(item.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-1 transition-opacity"
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Delete item</span>
                </button>
              </div>
            ))}

            {/* + List item Prompt */}
            <div
              onClick={handleAddNewItem}
              className="flex items-center gap-2 py-1 text-muted-foreground hover:text-foreground cursor-pointer select-none"
            >
              <Plus className="h-4 w-4 ml-6 shrink-0" />
              <span className="text-sm sm:text-base">List item</span>
            </div>

            {/* Completed Items Section */}
            {completedItems.length > 0 && (
              <div className="pt-2 border-t border-border/50 mt-2">
                <button
                  type="button"
                  onClick={() => setShowCompleted(!showCompleted)}
                  className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground hover:text-foreground font-medium mb-1"
                >
                  {showCompleted ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <span>
                    {completedItems.length}{" "}
                    {completedItems.length === 1
                      ? "completed item"
                      : "completed items"}
                  </span>
                </button>

                {showCompleted &&
                  completedItems.map((item) => (
                    <div
                      key={item.id}
                      className="group flex items-center gap-2 py-1 pl-6"
                    >
                      <Checkbox
                        checked={item.checked}
                        onCheckedChange={() =>
                          handleToggleItemChecked(item.id)
                        }
                        className="h-4 w-4 shrink-0 rounded border-gray-400"
                      />
                      <span className="text-sm sm:text-base text-muted-foreground line-through flex-1 min-w-0 break-words">
                        {item.content || "Empty item"}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-1 transition-opacity"
                      >
                        <X className="h-4 w-4" />
                        <span className="sr-only">Delete item</span>
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
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
                className="hover:text-foreground ml-0.5"
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
              <span>{tag}</span>
              <button
                type="button"
                onClick={() =>
                  setSelectedTags((prev) => prev.filter((t) => t !== tag))
                }
                className="hover:text-foreground ml-0.5"
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
                onClick={() => fileInputRef.current?.click()}
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
              className="w-auto p-2 bg-popover text-popover-foreground border-border shadow-md"
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
                className={cn("text-secondary", showFormatting && "bg-accent")}
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
                      editor.isActive("bold") && "bg-accent"
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
                      editor.isActive("italic") && "bg-accent"
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
                      editor.isActive("underline") && "bg-accent"
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
          className="text-sm font-semibold px-4 py-1.5 hover:bg-muted/50 rounded text-foreground"
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

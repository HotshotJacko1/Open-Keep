import React from "react";
import { Note } from "@/types/note";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pin, Archive, Trash2, Square, Check, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { isChecklist, parseChecklist } from "@/utils/markdown";

import useLongPress from "@/hooks/use-long-press";
import { useState, useEffect } from "react";
import { getImageSrc } from "@/lib/image-storage";

interface NoteCardProps {
  note: Note;
  onEdit: (note: Note) => void;
  onPinToggle: (id: string) => void;
  onArchiveToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleListItem?: (noteId: string, itemId: string) => void; // Remapped to index-based toggle in parent
  onRestore?: (id: string) => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect: (id: string, selected: boolean) => void;
}

const NoteCard: React.FC<NoteCardProps> = ({
  note,
  onEdit,
  onPinToggle,
  onArchiveToggle,
  onDelete,
  onRestore,
  onToggleListItem,
  isSelected,
  isSelectionMode,
  onSelect,
}) => {
  const handleCardClick = () => {
    if (isSelectionMode) {
      onSelect(note.id, !isSelected);
    } else {
      onEdit(note);
    }
  };

  const handleLongPress = (e: React.TouchEvent | React.MouseEvent) => {
    // Allow selection even if the note is deleted
    onSelect(note.id, !isSelected);
  };

  const longPressProps = useLongPress(handleLongPress, handleCardClick, {
    shouldPreventDefault: true,
    delay: 500,
  });

  const handleSelectionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(note.id, !isSelected);
  };

  // Determine view mode based on content
  const isList = isChecklist(note.content);
  // Parse content for display
  const displayContent = isList ? parseChecklist(note.content).items.slice(0, 8) : null; // Show first 8 items max

  const [bannerSrc, setBannerSrc] = useState<string | null>(null);

  useEffect(() => {
    if (note.images && note.images.length > 0) {
      getImageSrc(note.images[0]).then(setBannerSrc).catch(() => setBannerSrc(null));
    } else {
      setBannerSrc(null);
    }
  }, [note.images]);

  return (
    <Card
      className={cn(
        "group block w-full max-w-full relative break-inside-avoid-column mb-4 hover:shadow-lg transition-shadow duration-200 bg-card dark:bg-card text-secondary-foreground cursor-pointer border-2 border-input select-none",
        isSelected && "border-secondary-foreground shadow-lg bg-card",
        note.isDeleted && "opacity-75"
      )}
      {...longPressProps}
    >
      {/* Selection Checkbox */}
      <div
        className={cn(
          "absolute top-0 left-0 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200",
          (isSelected || isSelectionMode) && "opacity-100"
        )}
        onClick={handleSelectionClick}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <div className={cn(
          "w-6 h-6 rounded-full border-2 border-secondary dark:border-secondary bg-transparent flex items-center justify-center hover:bg-secondary-foreground -translate-x-1/2 -translate-y-1/2",
          isSelected && "bg-secondary-foreground dark:bg-secondary-foreground border-secondary dark:border-secondary text-secondary-foreground"
        )}>
          {isSelected && <Check className="h-4 w-4 text-secondary dark:text-secondary" />}
          {!isSelected && <Check className="h-4 w-4 text-transparent hover:text-secondary-foreground dark:hover:text-black" />}
        </div>
      </div>

      <CardHeader className="pb-2 flex flex-row items-start justify-between p-4 gap-2 min-w-0 w-full max-w-full">
        <div className="flex flex-col w-full gap-2 min-w-0">
          {bannerSrc && (
            <div className="w-full h-40 overflow-hidden rounded-lg mb-2">
              <img
                src={bannerSrc}
                alt=""
                className="w-full h-full object-cover"
                draggable={false}
              />
            </div>
          )}
          <div className="flex flex-row items-start justify-between gap-2 min-w-0 w-full max-w-full">
            <CardTitle className="text-base sm:text-lg font-semibold break-words flex-1 leading-snug min-w-0 max-w-full overflow-hidden [overflow-wrap:anywhere]">{note.title}</CardTitle>
        <div className={cn("hidden md:flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex-shrink-0", isSelectionMode && "opacity-0 pointer-events-none")}>
          {note.isDeleted ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore?.(note.id);
                }}
                title="Restore"
              >
                <RotateCcw className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(note.id);
                }}
                title="Delete Forever"
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onPinToggle(note.id);
                }}
                className={cn(note.isPinned ? "text-primary" : "text-muted-foreground")}
              >
                <Pin className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onArchiveToggle(note.id);
                }}
              >
                <Archive className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(note.id);
                }}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground text-red-400" />
              </Button>
            </>
          )}
        </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {isList && displayContent ? (
          <ul className="space-y-1 w-full overflow-hidden">
            {displayContent.map((item, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-black dark:text-white w-full overflow-hidden">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    // We need to pass the original line index to toggle.
                    // parseChecklist might return subset or reordered? 
                    // No, parseChecklist returns sequential items found.
                    // But we likely want to key off the ID if possible, or just index.
                    // For now, let's assume index in the parsed array corresponds to finding it in the text?
                    // No, `toggleCheckboxInContent` expects line index of the file.
                    // Ideally `parseChecklist` returns the line index from source.
                    // For now, note toggle might be tricky without line index.
                    // Let's pass the index we are mapping over, assuming `displayContent` are the first N items which correspond to first N lines? 
                    // No, empty lines or non-list lines would shift indices.
                    // Let's rely on parent to handle it? 
                    // For this refactor I will pass the ITEM ID (which I set to line-{index} in utils)
                    // The parent can parse the index from the ID.
                    onToggleListItem && onToggleListItem(note.id, item.id);
                  }}
                  disabled={isSelectionMode}
                >
                  {item.checked ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
                <span className={cn(item.checked && "line-through opacity-70", "flex-1 min-w-0 break-words overflow-hidden [overflow-wrap:anywhere] leading-tight mt-0.5")}>
                  {item.content}
                </span>
              </li>
            ))}
            {/* If trimmed, show ... */}
          </ul>
        ) : (
          <div
            className="text-sm text-secondary-foreground max-h-[300px] overflow-hidden text-ellipsis prose prose-sm max-w-none min-w-0 break-words w-full dark:prose-invert prose-p:my-0 prose-headings:my-1 [&_*]:break-words [overflow-wrap:anywhere]"
            dangerouslySetInnerHTML={{ __html: note.content }}
          />
        )}
        {note.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 w-full max-w-full overflow-hidden">
            {note.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 max-w-full whitespace-normal break-words [overflow-wrap:anywhere]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default NoteCard;
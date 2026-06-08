// Copyright (c) 2026. Licensed under AGPLv3.
import React from "react";
import { Note } from "@/types/note";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pin, Archive, Trash2, Square, Check, RotateCcw, Bell, ChevronDown, ChevronRight } from "lucide-react";
import { formatReminderLabel } from "@/utils/reminder";
import { cn } from "@/lib/utils";
import { isChecklist, parseChecklist, ChecklistItem } from "@/utils/markdown";

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
  // Parse and split content for display
  const parsedItems = isList ? parseChecklist(note.content).items : null;
  const uncheckedItems = parsedItems ? parsedItems.filter(item => !item.checked) : [];
  const checkedItems = parsedItems ? parsedItems.filter(item => item.checked) : [];

  // Limit total visible items to 8
  const maxItems = 8;
  const visibleUnchecked = uncheckedItems.slice(0, maxItems);
  const remainingSlots = Math.max(0, maxItems - visibleUnchecked.length);
  const visibleChecked = checkedItems.slice(0, remainingSlots);

  const [showCompleted, setShowCompleted] = useState(true);

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
            {!note.isDeleted && (
              <div className={cn(
                "hidden md:flex flex-shrink-0 transition-opacity duration-200",
                note.isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                isSelectionMode && "opacity-0 pointer-events-none"
              )}>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPinToggle(note.id);
                  }}
                  className={cn(note.isPinned ? "text-amber-400" : "text-muted-foreground")}
                  title={note.isPinned ? "Unpin" : "Pin"}
                >
                  <Pin className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {isList && parsedItems ? (() => {
          const renderItem = (item: ChecklistItem, index: number) => {
            const indentLevel = Math.floor((item.indentation?.length ?? 0) / 2);
            return (
              <li key={item.id} className="flex items-start gap-2 text-sm text-black dark:text-white w-full overflow-hidden" style={{ paddingLeft: `${indentLevel * 1}rem` }}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
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
            );
          };

          return (
            <div className="w-full overflow-hidden">
              {/* Unchecked items */}
              {visibleUnchecked.length > 0 && (
                <ul className="space-y-1 w-full overflow-hidden">
                  {visibleUnchecked.map(renderItem)}
                </ul>
              )}

              {/* Completed items divider & section */}
              {checkedItems.length > 0 && (
                <>
                  <button
                    className="flex items-center gap-2 w-full py-1.5 mt-1 text-xs text-muted-foreground hover:text-secondary-foreground transition-colors duration-150"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCompleted(prev => !prev);
                    }}
                  >
                    {showCompleted ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>{checkedItems.length} completed {checkedItems.length === 1 ? 'item' : 'items'}</span>
                  </button>
                  {showCompleted && (
                    <ul className="space-y-1 w-full overflow-hidden">
                      {visibleChecked.map(renderItem)}
                    </ul>
                  )}
                </>
              )}
            </div>
          );
        })() : (
          <div
            className="text-sm text-secondary-foreground max-h-[300px] overflow-hidden text-ellipsis prose prose-sm max-w-none min-w-0 w-full dark:prose-invert prose-p:my-0 prose-headings:my-1 [overflow-wrap:anywhere] [word-break:break-word] [&_*]:[overflow-wrap:anywhere] [&_*]:[word-break:break-word]"
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
        {note.reminder && (
          <div className={cn(
            "mt-2 inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5",
            note.reminder > Date.now()
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              : "bg-muted text-muted-foreground line-through"
          )}>
            <Bell className="h-3 w-3" />
            {formatReminderLabel(note.reminder)}
          </div>
        )}

        {/* Action buttons row — visible on hover (desktop only) */}
        <div className={cn(
          "hidden md:flex items-center justify-end gap-1 mt-2 -mb-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200",
          isSelectionMode && "opacity-0 pointer-events-none"
        )}>
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
                  onArchiveToggle(note.id);
                }}
                title="Archive"
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
                title="Delete"
              >
                <Trash2 className="h-4 w-4 text-red-400" />
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default NoteCard;
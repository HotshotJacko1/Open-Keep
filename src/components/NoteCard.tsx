import React from "react";
import { Note, NoteType, TextNote, ListNote } from "@/types/note";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pin, Archive, Trash2, Square, Check } from "lucide-react"; // Removed Edit icon
import { cn } from "@/lib/utils";

interface NoteCardProps {
  note: Note;
  onEdit: (note: Note) => void;
  onPinToggle: (id: string) => void;
  onArchiveToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleListItem?: (noteId: string, itemId: string) => void;
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
  onToggleListItem,
  isSelected,
  isSelectionMode,
  onSelect,
}) => {
  const handleCardClick = (e: React.MouseEvent) => {
    if (isSelectionMode) {
      onSelect(note.id, !isSelected);
    } else {
      onEdit(note);
    }
  };

  const handleSelectionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(note.id, !isSelected);
  };

  return (
    <Card
      className={cn(
        "group relative break-inside-avoid-column mb-4 hover:shadow-lg transition-shadow duration-200 bg-white dark:bg-[#202124] text-white cursor-pointer border-2 border-input", // Removed shadow-md
        isSelected && "border-primary shadow-lg bg-white dark:bg-[#202124]/90" // Highlight when selected
      )}
      onClick={handleCardClick}
    >
      {/* Selection Checkbox */}
      <div
        className={cn(
          "absolute -top-3 -left-3 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200",
          (isSelected || isSelectionMode) && "opacity-100" // Always visible if selected or in selection mode
        )}
        onClick={handleSelectionClick}
      >
        <div className={cn(
          "w-6 h-6 rounded-full border-2 border-muted-foreground bg-transparent flex items-center justify-center hover:bg-secondary-foreground",
          isSelected && "bg-secondary-foreground dark:bg-secondary-foreground border-secondary dark:border-secondary text-secondary-foreground"
        )}>
          {isSelected && <Check className="h-4 w-4 text-secondary dark:text-secondary" />}
          {!isSelected && <Check className="h-4 w-4 hover:text-background hover:dark:text-secondary-foreground" />} {/* Placeholder to keep size */}
        </div>
      </div>

      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold">{note.title}</CardTitle>
        <div className={cn("flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200", isSelectionMode && "opacity-0 pointer-events-none")}> {/* Hide actions in selection mode */}
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation(); // Prevent card's onClick from firing
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
              e.stopPropagation(); // Prevent card's onClick from firing
              onArchiveToggle(note.id);
            }}
          >
            <Archive className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation(); // Prevent card's onClick from firing
              onDelete(note.id);
            }}
          >
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
          {/* Edit button removed as requested */}
        </div>
      </CardHeader>
      <CardContent>
        {note.type === NoteType.Text ? (
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {(note as TextNote).content}
          </p>
        ) : (
          <ul className="space-y-1">
            {(note as ListNote).items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm text-foreground">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent card's onClick from firing
                    onToggleListItem && onToggleListItem(note.id, item.id);
                  }}
                  disabled={isSelectionMode} // Disable list toggling in selection mode
                >
                  {item.isCompleted ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
                <span className={cn(item.isCompleted && "line-through text-muted-foreground")}>
                  {item.content}
                </span>
              </li>
            ))}
          </ul>
        )}
        {note.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {note.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
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
import React from "react";
import { Note, NoteType, TextNote, ListNote } from "@/types/note";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pin, Archive, Trash2, Square, CheckSquare } from "lucide-react"; // Removed Edit icon
import { cn } from "@/lib/utils";

interface NoteCardProps {
  note: Note;
  onEdit: (note: Note) => void;
  onPinToggle: (id: string) => void;
  onArchiveToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleListItem?: (noteId: string, itemId: string) => void;
}

const NoteCard: React.FC<NoteCardProps> = ({
  note,
  onEdit,
  onPinToggle,
  onArchiveToggle,
  onDelete,
  onToggleListItem,
}) => {
  return (
    <Card
      className="break-inside-avoid-column mb-4 shadow-md hover:shadow-lg transition-shadow duration-200 bg-[#202124] text-white cursor-pointer"
      onClick={() => onEdit(note)} // Make the entire card clickable for editing
    >
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold">{note.title}</CardTitle>
        <div className="flex space-x-1">
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
                >
                  {item.isCompleted ? (
                    <CheckSquare className="h-4 w-4 text-green-500" />
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
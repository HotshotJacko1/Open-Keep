"use client";

import React from "react";
import { Note } from "@/types/note";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pin, Trash2, Archive, MoreVertical, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import ReactMarkdown from 'react-markdown';

interface NoteCardProps {
  note: Note;
  onClick: (note: Note) => void;
  onPin: (note: Note) => void;
  onArchive: (note: Note) => void;
  onDelete: (note: Note) => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (noteId: string) => void;
}

const NoteCard: React.FC<NoteCardProps> = ({
  note,
  onClick,
  onPin,
  onArchive,
  onDelete,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelection
}) => {
  const handleCardClick = (e: React.MouseEvent) => {
    if (isSelectionMode) {
      onToggleSelection?.(note.id);
    } else {
      onClick(note);
    }
  };

  const handlePinClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPin(note);
  };

  const handleArchiveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onArchive(note);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(note);
  };

  const handleSelectionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSelection?.(note.id);
  };

  return (
    <Card 
      className={cn(
        "group relative cursor-pointer transition-all duration-200 hover:shadow-md border-secondary/20 bg-card",
        isSelected && "ring-2 ring-primary border-primary",
        isSelectionMode && "hover:scale-[1.01]"
      )}
      onClick={handleCardClick}
    >
      <CardHeader className="p-4 pb-2 space-y-0">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-medium line-clamp-2 text-primary-foreground">
            {note.title || "Untitled"}
          </CardTitle>
          
          <div className="flex items-center gap-1">
            {isSelectionMode ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleSelectionClick}
              >
                {isSelected ? (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground" />
                )}
              </Button>
            ) : (
              <div className={cn("hidden md:flex flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200", isSelectionMode && "opacity-0 pointer-events-none")}>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8", note.isPinned && "text-yellow-500 hover:text-yellow-600")}
                  onClick={handlePinClick}
                >
                  <Pin className={cn("h-4 w-4", note.isPinned && "fill-current")} />
                  <span className="sr-only">{note.isPinned ? "Unpin" : "Pin"}</span>
                </Button>
              </div>
            )}
            
            {/* Mobile Pin Indicator */}
            {!isSelectionMode && note.isPinned && (
              <div className="md:hidden">
                <Pin className="h-4 w-4 text-yellow-500 fill-current" />
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-4 pt-0 pb-2">
        <div className="text-sm text-muted-foreground line-clamp-6 prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{note.content}</ReactMarkdown>
        </div>
        
        {note.tags && note.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {note.tags.map((tag) => (
              <span 
                key={tag} 
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-secondary/30 text-secondary-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </CardContent>
      
      <CardFooter className="p-4 pt-0 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {formatDistanceToNow(note.updatedAt, { addSuffix: true })}
        </span>
        
        {!isSelectionMode && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleArchiveClick}
            >
              <Archive className="h-4 w-4" />
              <span className="sr-only">Archive</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={handleDeleteClick}
            >
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Delete</span>
            </Button>
          </div>
        )}
      </CardFooter>
    </Card>
  );
};

export default NoteCard;
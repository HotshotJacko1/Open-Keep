"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Edit, Pin, Archive, Trash2, MoreHorizontal, Palette } from "lucide-react";
import { useTheme } from "@/context/theme-provider";
import { showSuccess } from "@/utils/toast";

interface NoteCardProps {
  note: {
    id: string;
    title: string;
    content: string;
    tags: string[];
    color: string;
    isPinned: boolean;
    isArchived: boolean;
    createdAt: number;
    updatedAt: number;
  };
  onPin: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (note: any) => void;
  onColorChange: (id: string, color: string) => void;
}

const PREDEFINED_COLORS = [
  { name: "Default", value: "default" },
  { name: "Red", value: "#ff8888" },
  { name: "Orange", value: "#ffbb88" },
  { name: "Yellow", value: "#ffee88" },
  { name: "Green", value: "#88ff88" },
  { name: "Teal", value: "#88ddff" },
  { name: "Blue", value: "#8888ff" },
  { name: "Purple", value: "#cc88ff" },
  { name: "Pink", value: "#ff88cc" },
  { name: "Gray", value: "#bbbbbb" },
];

const NoteCard: React.FC<NoteCardProps> = ({
  note,
  onPin,
  onArchive,
  onDelete,
  onEdit,
  onColorChange,
}) => {
  const { theme } = useTheme();
  const [showMenu, setShowMenu] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
      setShowMenu(false);
    }
    if (colorPickerRef.current && !colorPickerRef.current.contains(event.target as Node)) {
      setShowColorPicker(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [handleClickOutside]);

  const getCardStyles = () => {
    const base =
      "relative rounded-lg border p-4 transition-all duration-200 hover:shadow-lg cursor-pointer select-none";

    if (note.color === "default") {
      return `${base} bg-card text-card-foreground border-border`;
    }

    const isDarkMode = theme === "dark";
    const textClass = isDarkMode ? "text-white" : "text-gray-900";

    return `${base} ${textClass}`;
  };

  const getColorPalette = (color: string) => {
    if (color === "default") return undefined;
    return color;
  };

  const handleColorSelect = (colorValue: string) => {
    onColorChange(note.id, colorValue);
    setShowColorPicker(false);
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", note.id);
    e.currentTarget.classList.add("opacity-50");
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove("opacity-50");
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  };

  const stripMarkdown = (text: string) => {
    return text
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/`{1,3}[^`]*`{1,3}/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^- /gm, "")
      .replace(/^\d+\. /gm, "")
      .replace(/---/g, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/> /gm, "");
  };

  const getPreviewContent = () => {
    if (note.content) {
      return stripMarkdown(note.content).substring(0, 100);
    }
    return null;
  };

  const previewContent = getPreviewContent();

  return (
    <div
      className={getCardStyles()}
      style={{ backgroundColor: getColorPalette(note.color) }}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex items-start justify-between mb-2">
        <h3
          className="font-semibold text-base truncate flex-1 mr-2"
          onClick={() => onEdit(note)}
        >
          {note.title || "Untitled"}
        </h3>
        <div className="flex gap-1 shrink-0" ref={menuRef}>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onPin(note.id);
              showSuccess(note.isPinned ? "Note unpinned" : "Note pinned");
            }}
            className="h-7 w-7"
          >
            <Pin
              className={`h-4 w-4 ${note.isPinned ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground"}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onArchive(note.id);
              showSuccess(note.isArchived ? "Note unarchived" : "Note archived");
            }}
            className="h-7 w-7"
          >
            <Archive className="h-4 w-4 text-muted-foreground" />
          </Button>
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setShowMenu(!showMenu);
                setShowColorPicker(false);
              }}
              className="h-7 w-7"
            >
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </Button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-md shadow-lg z-50 py-1 w-40">
                <button
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-card-foreground hover:bg-muted transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setShowColorPicker(!showColorPicker);
                  }}
                >
                  <Palette className="h-4 w-4" />
                  Change Color
                </button>
                <button
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-card-foreground hover:bg-muted transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onDelete(note.id);
                    showSuccess("Note deleted");
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                  Delete
                </button>
              </div>
            )}
            {showColorPicker && (
              <div
                ref={colorPickerRef}
                className="absolute right-0 top-full mt-1 bg-card border border-border rounded-md shadow-lg z-50 p-2"
                style={{ marginTop: showMenu ? "2.5rem" : "0" }}
              >
                <div className="flex flex-wrap gap-1 w-48">
                  {PREDEFINED_COLORS.map((color) => (
                    <button
                      key={color.value}
                      className={`w-7 h-7 rounded-full border border-border ${
                        note.color === color.value ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : ""
                      }`}
                      style={{
                        backgroundColor: color.value === "default" ? "var(--card)" : color.value,
                      }}
                      title={color.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        handleColorSelect(color.value);
                        setShowMenu(false);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {previewContent && (
        <p
          className="text-sm text-muted-foreground line-clamp-3 leading-relaxed"
          onClick={() => onEdit(note)}
        >
          {previewContent}
        </p>
      )}
      <div className="flex flex-wrap gap-1 mt-3">
        {note.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary"
          >
            {tag}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
        <span>{formatDate(note.updatedAt)}</span>
        {note.isArchived && (
          <>
            <span>•</span>
            <span className="text-muted-foreground">Archived</span>
          </>
        )}
      </div>
    </div>
  );
};

export default NoteCard;
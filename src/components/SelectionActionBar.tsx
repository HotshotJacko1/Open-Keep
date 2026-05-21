// Copyright (c) 2026. Licensed under AGPLv3.
import React from "react";
import { X, Pin, Archive, Trash2, Upload, Tag, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import NoteLabels from "@/components/NoteLabels";
import { cn } from "@/lib/utils";

interface SelectionActionBarProps {
    selectedCount: number;
    onClearSelection: () => void;
    onPin: () => void;
    onArchive: () => void;
    onDelete: () => void;
    onRestore?: () => void;
    showRestore?: boolean;
    onUnarchive?: () => void;
    showUnarchive?: boolean;
    hideArchive?: boolean;
    hidePin?: boolean;
    onExport: () => void;
    availableTags: string[];
    tagStates: Record<string, boolean | "indeterminate">;
    onTagToggle: (tag: string) => void;
}

export const SelectionActionBar: React.FC<SelectionActionBarProps> = ({
    selectedCount,
    onClearSelection,
    onPin,
    onArchive,
    onDelete,
    onRestore,
    showRestore,
    onUnarchive,
    showUnarchive,
    hideArchive,
    hidePin,
    onExport,
    availableTags,
    tagStates,
    onTagToggle,
}) => {
    const [isLabelsOpen, setIsLabelsOpen] = React.useState(false);

    if (selectedCount === 0) return null;

    return (
        <div className="fixed top-0 left-0 right-0 z-50 bg-background border-b border-gray-700 px-2 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] flex items-center justify-between animate-in slide-in-from-top duration-200">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={onClearSelection}>
                    <X className="h-5 w-5 text-primary-foreground" />
                </Button>
                <span className="text-lg font-medium text-primary-foreground">
                    {selectedCount} selected
                </span>
            </div>

            <div className="flex items-center gap-1 sm:gap-2">
                {showRestore && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onRestore}
                        title="Restore"
                        className="text-primary hover:text-primary-foreground"
                    >
                        <RotateCcw className="h-5 w-5" />
                    </Button>
                )}
                {!hidePin && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onPin}
                        title="Pin"
                        className="text-primary hover:text-primary-foreground"
                    >
                        <Pin className="h-5 w-5" />
                    </Button>
                )}
                {!hideArchive && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onArchive}
                        title="Archive"
                        className="text-primary hover:text-primary-foreground"
                    >
                        <Archive className="h-5 w-5" />
                    </Button>
                )}
                {showUnarchive && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onUnarchive}
                        title="Unarchive"
                        className="text-primary hover:text-primary-foreground"
                    >
                        <Archive className="h-5 w-5" />
                    </Button>
                )}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onDelete}
                    title="Delete"
                    className="text-primary hover:text-primary-foreground"
                >
                    <Trash2 className="h-5 w-5" />
                </Button>

                <Button
                    variant="ghost"
                    size="icon"
                    title="Change labels"
                    className="text-primary hover:text-primary-foreground"
                    onClick={() => setIsLabelsOpen(true)}
                >
                    <Tag className="h-5 w-5" />
                </Button>

                <NoteLabels
                    isOpen={isLabelsOpen}
                    onClose={() => setIsLabelsOpen(false)}
                    availableTags={availableTags}
                    selectedTags={tagStates}
                    onTagToggle={onTagToggle}
                />

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onExport}
                    title="Export"
                    className="text-primary hover:text-primary-foreground"
                >
                    <Upload className="h-5 w-5" />
                </Button>
            </div>
        </div>
    );
};

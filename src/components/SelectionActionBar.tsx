// Copyright (c) 2026. Licensed under AGPLv3.
import React from "react";
import { X, Pin, Archive, Trash2, Upload, Tag, RotateCcw, MoreVertical, Info } from "lucide-react";
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
    onFileInfo?: () => void;
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
    onFileInfo,
    availableTags,
    tagStates,
    onTagToggle,
}) => {
    const [isLabelsOpen, setIsLabelsOpen] = React.useState(false);
    const [isOverflowOpen, setIsOverflowOpen] = React.useState(false);
    const overflowRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (!isOverflowOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
                setIsOverflowOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOverflowOpen]);

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
                        className="text-black dark:text-white hover:text-primary-foreground"
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
                        className="text-black dark:text-white hover:text-primary-foreground"
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
                        className="hidden sm:inline-flex text-black dark:text-white hover:text-primary-foreground"
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
                        className="hidden sm:inline-flex text-black dark:text-white hover:text-primary-foreground"
                    >
                        <Archive className="h-5 w-5" />
                    </Button>
                )}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onDelete}
                    title="Delete"
                    className="text-black dark:text-white hover:text-primary-foreground"
                >
                    <Trash2 className="h-5 w-5" />
                </Button>

                <Button
                    variant="ghost"
                    size="icon"
                    title="Change labels"
                    className="text-black dark:text-white hover:text-primary-foreground"
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
                    className="hidden sm:inline-flex text-black dark:text-white hover:text-primary-foreground"
                >
                    <Upload className="h-5 w-5" />
                </Button>

                {onFileInfo && selectedCount === 1 && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onFileInfo}
                        title="File Info"
                        className="hidden sm:inline-flex text-black dark:text-white hover:text-primary-foreground"
                    >
                        <Info className="h-5 w-5" />
                    </Button>
                )}

                {/* 3-dot overflow — mobile only */}
                <div className="relative sm:hidden" ref={overflowRef}>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsOverflowOpen((o) => !o)}
                        title="More options"
                        className="text-black dark:text-white hover:text-primary-foreground"
                    >
                        <MoreVertical className="h-5 w-5" />
                    </Button>

                    {isOverflowOpen && (
                        <div className="absolute right-0 top-full mt-1 w-44 rounded-md border border-gray-700 bg-background shadow-lg z-50 py-1 animate-in fade-in slide-in-from-top-1 duration-150">
                            {!hideArchive && (
                                <button
                                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-black dark:text-white hover:bg-muted"
                                    onClick={() => { onArchive(); setIsOverflowOpen(false); }}
                                >
                                    <Archive className="h-4 w-4" /> Archive
                                </button>
                            )}
                            {showUnarchive && (
                                <button
                                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-black dark:text-white-black hover:bg-muted"
                                    onClick={() => { onUnarchive?.(); setIsOverflowOpen(false); }}
                                >
                                    <Archive className="h-4 w-4" /> Unarchive
                                </button>
                            )}
                            <button
                                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-black dark:text-white hover:bg-muted"
                                onClick={() => { onExport(); setIsOverflowOpen(false); }}
                            >
                                <Upload className="h-4 w-4" /> Export
                            </button>
                            {onFileInfo && selectedCount === 1 && (
                                <button
                                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-black dark:text-white hover:bg-muted"
                                    onClick={() => { onFileInfo(); setIsOverflowOpen(false); }}
                                >
                                    <Info className="h-4 w-4" /> File Info
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

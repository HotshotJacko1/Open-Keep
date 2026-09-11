// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Check, Plus, Tag, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface NoteLabelsProps {
    isOpen: boolean;
    onClose: () => void;
    availableTags: string[];
    selectedTags: Record<string, boolean | "indeterminate">;
    onTagToggle: (tag: string) => void;
    onCreateTag?: (tag: string) => void;
}

const NoteLabels: React.FC<NoteLabelsProps> = ({
    isOpen,
    onClose,
    availableTags,
    selectedTags,
    onTagToggle,
    onCreateTag, // Optional, might be handled by onTagToggle if we treat toggling a non-existent tag as creation
}) => {
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        if (isOpen) {
            setSearchQuery("");
        }
    }, [isOpen]); // Only reset when dialog opens

    const filteredTags = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return availableTags;
        return availableTags.filter(tag => tag.toLowerCase().includes(query));
    }, [searchQuery, availableTags]);

    const handleCreate = () => {
        if (searchQuery.trim() && onCreateTag) {
            onCreateTag(searchQuery.trim());
            setSearchQuery("");
        } else if (searchQuery.trim()) {
            // Fallback if onCreateTag not provided, or treat as toggle
            onTagToggle(searchQuery.trim());
            setSearchQuery("");
        }
    };

    const showCreateOption = searchQuery.trim() && !availableTags.some(t => t.toLowerCase() === searchQuery.trim().toLowerCase());

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="w-[calc(100%-2rem)] sm:max-w-[340px] max-h-[75vh] p-0 gap-0 flex flex-col overflow-hidden rounded-lg text-text-primary dark:text-text-primary">
                <DialogTitle className="sr-only">Label note</DialogTitle>

                {/* Header: back arrow + inline label input, Keep-style */}
                <div className="flex items-center gap-1 pl-1 pr-3 py-2 shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Back"
                        className="shrink-0 h-10 w-10 flex items-center justify-center rounded-full transition-colors hover:bg-sidebar-foreground/25"
                    >
                        <ArrowLeft className="h-5 w-5 text-secondary" />
                    </button>
                    <Input
                        autoFocus
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Enter label name"
                        className="border-none shadow-none focus-visible:ring-0 px-1 h-9 text-base bg-transparent text-text-primary dark:text-text-primary placeholder:text-muted-foreground"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                if (showCreateOption) handleCreate();
                            }
                        }}
                    />
                </div>

                {/* Label list */}
                <div className="flex-1 min-h-0 overflow-y-auto py-1">
                    {filteredTags.map(tag => {
                        const state = selectedTags[tag];
                        const isChecked = state === true;
                        const isIndeterminate = state === 'indeterminate';
                        return (
                            <div
                                key={tag}
                                role="checkbox"
                                tabIndex={0}
                                aria-checked={isIndeterminate ? "mixed" : isChecked}
                                className="flex items-center gap-4 px-4 py-3 cursor-pointer select-none transition-colors hover:bg-sidebar-foreground/20 focus-visible:outline-none focus-visible:bg-sidebar-foreground/20"
                                onClick={() => onTagToggle(tag)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        onTagToggle(tag);
                                    }
                                }}
                            >
                                <Tag className="h-5 w-5 shrink-0 text-secondary" />
                                <span className="flex-1 min-w-0 text-base truncate" title={tag}>{tag}</span>
                                <div className={cn(
                                    "h-5 w-5 shrink-0 rounded-[3px] border-2 border-secondary flex items-center justify-center transition-colors",
                                    (isChecked || isIndeterminate) && "bg-sidebar-foreground border-sidebar-foreground"
                                )}>
                                    {isChecked && <Check className="h-3.5 w-3.5 text-black dark:text-white" strokeWidth={3} />}
                                    {isIndeterminate && <div className="h-0.5 w-2.5 bg-black dark:bg-white rounded-full" />}
                                </div>
                            </div>
                        );
                    })}

                    {filteredTags.length === 0 && !showCreateOption && (
                        <p className="px-4 py-6 text-sm text-muted-foreground">No labels yet.</p>
                    )}
                </div>

                {/* Create new label */}
                {showCreateOption && (
                    <div
                        className="shrink-0 flex items-center gap-4 px-4 py-3 cursor-pointer select-none border-t border-border transition-colors hover:bg-sidebar-foreground/20"
                        onClick={handleCreate}
                    >
                        <Plus className="h-5 w-5 shrink-0 text-secondary" />
                        <span className="text-base truncate">Create "{searchQuery.trim()}"</span>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default NoteLabels;

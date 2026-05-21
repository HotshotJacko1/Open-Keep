// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Plus, Tag } from "lucide-react";
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
    const [filteredTags, setFilteredTags] = useState<string[]>([]);

    useEffect(() => {
        if (isOpen) {
            setSearchQuery("");
            setFilteredTags(availableTags);
        }
    }, [isOpen]); // Only reset when dialog opens

    useEffect(() => {
        if (!searchQuery.trim()) {
            setFilteredTags(availableTags);
            return;
        }
        const lowerQuery = searchQuery.toLowerCase();
        setFilteredTags(availableTags.filter(tag => tag.toLowerCase().includes(lowerQuery)));
    }, [searchQuery, availableTags]); // Filter when query or tags change

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
            <DialogContent className="sm:max-w-[300px] p-0 gap-0 bg-[#202124] text-white overflow-hidden border-gray-700">
                <div className="p-2 border-b border-gray-700">
                    <DialogTitle className="text-sm font-medium mb-2 px-2">Label note</DialogTitle>
                    <Input
                        autoFocus
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Enter label name"
                        className="border-none focus-visible:ring-0 px-2 h-8 text-sm bg-transparent placeholder:text-gray-400"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                if (showCreateOption) handleCreate();
                            }
                        }}
                    />
                </div>

                <div className="max-h-[300px] overflow-y-auto py-1">
                    {filteredTags.map(tag => (
                        <div
                            key={tag}
                            className="flex items-center justify-between px-3 py-2 hover:bg-gray-700 cursor-pointer"
                            onClick={() => onTagToggle(tag)}
                        >
                            <div className="flex items-center gap-3">
                                <Tag className="h-4 w-4 text-gray-400" />
                                <span className="text-sm font-medium truncate max-w-[180px]">{tag}</span>
                            </div>
                            <div className={cn(
                                "h-4 w-4 border border-gray-500 rounded-sm flex items-center justify-center",
                                (selectedTags[tag] === true || selectedTags[tag] === 'indeterminate') && "bg-blue-500 border-blue-500"
                            )}>
                                {selectedTags[tag] === true && <Check className="h-3 w-3 text-white" />}
                                {selectedTags[tag] === 'indeterminate' && <div className="h-0.5 w-2 bg-white" />}
                            </div>
                        </div>
                    ))}

                    {showCreateOption && (
                        <div
                            className="flex items-center gap-2 px-3 py-2 hover:bg-gray-700 cursor-pointer border-t border-gray-700 mt-1"
                            onClick={handleCreate}
                        >
                            <Plus className="h-4 w-4 text-gray-400" />
                            <span className="text-sm font-medium text-white">Create "{searchQuery}"</span>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default NoteLabels;

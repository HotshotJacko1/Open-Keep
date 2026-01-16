import React from "react";
import { X, Pin, Archive, Trash2, Download, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
    DropdownMenuCheckboxItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface SelectionActionBarProps {
    selectedCount: number;
    onClearSelection: () => void;
    onPin: () => void;
    onArchive: () => void;
    onDelete: () => void;
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
    onExport,
    availableTags,
    tagStates,
    onTagToggle,
}) => {
    if (selectedCount === 0) return null;

    return (
        <div className="fixed top-0 left-0 right-0 z-50 bg-background border-b border-gray-700 p-2 flex items-center justify-between animate-in slide-in-from-top duration-200">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={onClearSelection}>
                    <X className="h-5 w-5 text-primary-foreground" />
                </Button>
                <span className="text-lg font-medium text-primary-foreground">
                    {selectedCount} selected
                </span>
            </div>

            <div className="flex items-center gap-1 sm:gap-2">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onPin}
                    title="Pin"
                    className="text-primary hover:text-primary-foreground"
                >
                    <Pin className="h-5 w-5" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onArchive}
                    title="Archive"
                    className="text-primary hover:text-primary-foreground"
                >
                    <Archive className="h-5 w-5" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onDelete}
                    title="Delete"
                    className="text-primary hover:text-primary-foreground"
                >
                    <Trash2 className="h-5 w-5" />
                </Button>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            title="Change labels"
                            className="text-white hover:text-primary-foreground"
                        >
                            <Tag className="h-5 w-5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 bg-[#202124] text-white border-gray-700">
                        <DropdownMenuLabel>Change labels</DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-gray-700" />
                        {availableTags.length === 0 && (
                            <div className="p-2 text-sm text-primary">No labels created yet</div>
                        )}
                        {availableTags.map(tag => (
                            <DropdownMenuCheckboxItem
                                key={tag}
                                checked={tagStates[tag] === true || tagStates[tag] === 'indeterminate'}
                                onCheckedChange={() => onTagToggle(tag)}
                                className="focus:bg-gray-700 focus:text-white cursor-pointer"
                            >
                                <span className={cn("flex items-center gap-2", tagStates[tag] === 'indeterminate' && "opacity-70")}>
                                    {tag} {tagStates[tag] === 'indeterminate' && "(some)"}
                                </span>
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onExport}
                    title="Export"
                    className="text-primary hover:text-primary-foreground"
                >
                    <Download className="h-5 w-5" />
                </Button>
            </div>
        </div>
    );
};

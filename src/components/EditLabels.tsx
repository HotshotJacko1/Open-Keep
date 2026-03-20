import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tag, Trash2, Pencil, Check, Plus, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

interface EditLabelsProps {
    isOpen: boolean;
    onClose: () => void;
    tags: string[];
    onCreateTag: (tag: string) => void;
    onRenameTag: (oldTag: string, newTag: string) => void;
    onDeleteTag: (tag: string) => void;
}

const EditLabels: React.FC<EditLabelsProps> = ({
    isOpen,
    onClose,
    tags,
    onCreateTag,
    onRenameTag,
    onDeleteTag,
}) => {
    const [newLabel, setNewLabel] = useState("");
    const [editingTag, setEditingTag] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");

    useEffect(() => {
        if (!isOpen) return;

        window.history.pushState({ dialog: 'edit-labels' }, "");

        const handlePopState = (event: PopStateEvent) => {
            if (event.state?.dialog === 'edit-labels') return;
            onClose();
        };

        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
            if (window.history.state?.dialog === 'edit-labels') {
                window.history.back();
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleCreate = () => {
        if (newLabel.trim()) {
            onCreateTag(newLabel.trim());
            setNewLabel("");
        }
    };

    const startEditing = (tag: string) => {
        setEditingTag(tag);
        setEditValue(tag);
    };

    const submitEdit = () => {
        if (editingTag && editValue.trim() && editValue.trim() !== editingTag) {
            onRenameTag(editingTag, editValue.trim());
        }
        setEditingTag(null);
        setEditValue("");
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-full w-full h-full sm:max-w-full m-0 !rounded-none border-none px-4 pt-[max(env(safe-area-inset-top,1rem),1rem)] pb-[max(env(safe-area-inset-bottom,1rem),1rem)] flex flex-col text-black dark:text-white">
                <DialogHeader className="flex flex-row items-center gap-2 space-y-0 text-left shrink-0">
                    <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 mt-0 h-8 w-8">
                        <ArrowLeft className="h-5 w-5 text-secondary" />
                        <span className="sr-only">Back</span>
                    </Button>
                    <DialogTitle>Edit Labels</DialogTitle>
                </DialogHeader>

                <div className="py-4 space-y-2 flex flex-col flex-1 min-h-0">
                    {/* Create New Label */}
                    <div className="flex items-center gap-2 px-2 py-2 border-b border-border mb-4">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="hover:bg-transparent"
                            onClick={() => setNewLabel("")} // clear on cancel logic if needed?
                        >
                            <Plus className="h-5 w-5 text-muted-foreground" />
                        </Button>
                        <Input
                            value={newLabel}
                            onChange={(e) => setNewLabel(e.target.value)}
                            placeholder="Create new label"
                            className="border-none shadow-none focus-visible:ring-0 px-0 placeholder:text-black dark:placeholder:text-white"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCreate();
                            }}
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            disabled={!newLabel.trim()}
                            onClick={handleCreate}
                        >
                            <Check className="h-5 w-5 text-muted-foreground" />
                        </Button>
                    </div>

                    {/* List of Labels */}
                    <div className="space-y-1 flex-1 overflow-y-auto">
                        {tags.map((tag) => (
                            <div
                                key={tag}
                                className="group flex items-center justify-between gap-2 px-2 py-1 rounded-md hover:bg-accent/50 transition-colors"
                                onMouseLeave={() => {
                                    if (editingTag !== tag) {
                                        // potentially logic to reset something?
                                    }
                                }}
                            >
                                {/* Left Icon (Tag / Trash) */}
                                <div className="flex items-center">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                                        onClick={() => onDeleteTag(tag)}
                                    >
                                        <Tag className="h-4 w-4 group-hover:hidden transition-all" />
                                        <Trash2 className="h-4 w-4 hidden group-hover:block transition-all" />
                                    </Button>
                                </div>

                                {/* Tag Name / Input */}
                                <div className="flex-1 min-w-0">
                                    {editingTag === tag ? (
                                        <Input
                                            value={editValue}
                                            onChange={(e) => setEditValue(e.target.value)}
                                            className="h-8 py-1 px-2"
                                            autoFocus
                                            onBlur={submitEdit}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') submitEdit();
                                            }}
                                        />
                                    ) : (
                                        <span
                                            className="text-sm font-medium truncate block cursor-pointer"
                                            title={tag}
                                            onClick={() => startEditing(tag)}
                                        >
                                            {tag}
                                        </span>
                                    )}
                                </div>

                                {/* Right Icon (Pencil / Check) */}
                                <div className="flex items-center">
                                    {editingTag === tag ? (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-primary"
                                            onClick={submitEdit}
                                        >
                                            <Check className="h-4 w-4" />
                                        </Button>
                                    ) : (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground"
                                            onClick={() => startEditing(tag)}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

            </DialogContent>
        </Dialog>
    );
};

export default EditLabels;

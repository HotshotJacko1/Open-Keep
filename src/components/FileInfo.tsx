// Copyright (c) 2026. Licensed under AGPLv3.
import React from "react";
import { Note } from "@/types/note";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Info, Calendar, Clock, Tag, Type, Image, Hash, Fingerprint } from "lucide-react";

interface FileInfoProps {
    isOpen: boolean;
    onClose: () => void;
    note: Note;
}

function formatDateTime(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    }).format(new Date(timestamp));
}

function getWordCount(content: string): number {
    // Strip HTML tags and count words
    const text = content.replace(/<[^>]+>/g, " ").trim();
    if (!text) return 0;
    return text.split(/\s+/).filter(Boolean).length;
}

function getCharCount(content: string): number {
    return content.replace(/<[^>]+>/g, "").length;
}

const InfoRow: React.FC<{
    icon: React.ReactNode;
    label: string;
    value: string | number;
}> = ({ icon, label, value }) => (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
        <div className="text-text-primary dark:text-text-primary mt-0.5 shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-text-primary dark:text-text-primary uppercase tracking-wide mb-0.5">
                {label}
            </p>
            <p className="text-sm text-text-primary dark:text-text-primary break-words">{value}</p>
        </div>
    </div>
);

const FileInfo: React.FC<FileInfoProps> = ({ isOpen, onClose, note }) => {
    const wordCount = getWordCount(note.content);
    const charCount = getCharCount(note.content);
    const noteType = note.type === "list" ? "Checklist" : "Text";
    const imageCount = note.images?.length ?? 0;
    const tagList = note.tags.length > 0 ? note.tags.join(", ") : "None";

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-text-primary dark:text-text-primary">
                        <Info className="h-5 w-5 text-text-primary dark:text-text-primary" />
                        File Information
                    </DialogTitle>
                </DialogHeader>

                <div className="mt-2">
                    <InfoRow
                        icon={<Calendar className="h-4 w-4" />}
                        label="Created"
                        value={formatDateTime(note.createdAt)}
                    />
                    <InfoRow
                        icon={<Clock className="h-4 w-4" />}
                        label="Last Modified"
                        value={formatDateTime(note.updatedAt)}
                    />
                    <InfoRow
                        icon={<Type className="h-4 w-4" />}
                        label="Type"
                        value={noteType}
                    />
                    <InfoRow
                        icon={<Tag className="h-4 w-4" />}
                        label="Labels"
                        value={tagList}
                    />
                    <InfoRow
                        icon={<Hash className="h-4 w-4" />}
                        label="Words / Characters"
                        value={`${wordCount} words · ${charCount} characters`}
                    />
                    {imageCount > 0 && (
                        <InfoRow
                            icon={<Image className="h-4 w-4" />}
                            label="Images"
                            value={imageCount}
                        />
                    )}
                    <InfoRow
                        icon={<Fingerprint className="h-4 w-4" />}
                        label="Note ID"
                        value={note.id}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default FileInfo;

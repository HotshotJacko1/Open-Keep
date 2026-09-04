// Copyright (c) 2026. Licensed under AGPLv3.
import React from "react";
import { Ban, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_NOTE_COLOR, NOTE_COLORS } from "@/lib/note-colors";

interface NoteColorPickerProps {
    value?: string;
    onChange: (colorId: string) => void;
    disabled?: boolean;
}

/**
 * The swatch row. Each swatch paints both theme values as CSS custom
 * properties and lets the .note-swatch rules in globals.css pick one, for the
 * same reason the cards do -- the resolved theme is not available to JS.
 */
const NoteColorPicker: React.FC<NoteColorPickerProps> = ({ value, onChange, disabled }) => {
    const selected = value || DEFAULT_NOTE_COLOR;

    return (
        <div
            role="radiogroup"
            aria-label="Note colour"
            className="flex flex-wrap items-center gap-2 p-1"
        >
            {NOTE_COLORS.map((color) => {
                const isSelected = color.id === selected;
                const isDefault = color.id === DEFAULT_NOTE_COLOR;

                return (
                    <button
                        key={color.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        aria-label={color.label}
                        title={color.label}
                        disabled={disabled}
                        onClick={() => onChange(color.id)}
                        style={
                            isDefault
                                ? undefined
                                : ({
                                    "--note-tint": color.light,
                                    "--note-tint-dark": color.dark,
                                } as React.CSSProperties)
                        }
                        className={cn(
                            "relative h-8 w-8 shrink-0 rounded-full border-2 transition-transform",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            "disabled:opacity-50 disabled:cursor-not-allowed",
                            !disabled && "hover:scale-110",
                            isSelected ? "border-secondary-foreground" : "border-input",
                            isDefault ? "bg-card" : "note-swatch"
                        )}
                    >
                        {isDefault && (
                            <Ban className="absolute inset-0 m-auto h-4 w-4 text-muted-foreground" />
                        )}
                        {isSelected && (
                            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-secondary-foreground">
                                <Check className="h-3 w-3 text-secondary" />
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
};

export default NoteColorPicker;

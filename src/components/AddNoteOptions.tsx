// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ListChecks, Plus, Type, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface AddNoteOptionsProps {
  onNewTextNote: () => void;
  onNewListNote: () => void;
}

// M3 FAB menu items: 56px pills in the tinted container colour that rise out
// of the FAB one after another, nearest first. `fill-mode-backwards` keeps an
// item hidden during its delay instead of flashing in at its final position.
const menuItemClass =
  "press-feedback h-14 w-fit gap-3 rounded-full px-6 text-base font-medium cursor-pointer shadow-md " +
  "bg-brand-container text-brand-container-foreground focus:bg-brand-container focus:text-brand-container-foreground " +
  "focus-visible:ring-2 focus-visible:ring-ring " +
  "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 fill-mode-backwards duration-md3-short4 ease-md3-decelerate";

const AddNoteOptions: React.FC<AddNoteOptionsProps> = ({
  onNewTextNote,
  onNewListNote,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={open ? "Close" : "New note"}
          // M3 FAB: a 56px rounded square in the tinted container colour. While
          // its menu is open it morphs into a round close button in the
          // stronger brand colour, per the M3 FAB menu pattern.
          className={cn(
            "fixed bottom-[calc(2rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] right-8 z-50 h-14 w-14",
            "shadow-lg hover:shadow-xl",
            "transition-[background-color,color,box-shadow,border-radius] duration-md3-medium2 ease-md3-standard",
            open
              ? "rounded-[28px] bg-brand text-brand-foreground hover:bg-brand"
              : "rounded-fab bg-brand-container text-brand-container-foreground hover:bg-brand-container"
          )}
          size="icon"
        >
          {/* Both icons are stacked and cross-fade with a quarter turn. */}
          <Plus
            aria-hidden="true"
            className={cn(
              "absolute !h-6 !w-6 transition-[transform,opacity] duration-md3-medium2 ease-md3-standard",
              open ? "rotate-90 opacity-0" : "rotate-0 opacity-100"
            )}
          />
          <X
            aria-hidden="true"
            className={cn(
              "absolute !h-6 !w-6 transition-[transform,opacity] duration-md3-medium2 ease-md3-standard",
              open ? "rotate-0 opacity-100" : "-rotate-90 opacity-0"
            )}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        sideOffset={8}
        // The items animate themselves (staggered), so the container's own
        // open animation is switched off; its quick fade-out on close stays.
        className="data-[state=open]:[animation:none] bg-transparent border-none shadow-none flex flex-col items-end gap-1 p-0 overflow-visible"
      >
        <DropdownMenuItem onClick={onNewTextNote} className={cn(menuItemClass, "[animation-delay:50ms]")}>
          <Type className="h-5 w-5" aria-hidden="true" />
          Text
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onNewListNote} className={menuItemClass}>
          <ListChecks className="h-5 w-5" aria-hidden="true" />
          List
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default AddNoteOptions;

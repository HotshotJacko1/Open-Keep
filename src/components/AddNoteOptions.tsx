// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface AddNoteOptionsProps {
  onNewTextNote: () => void;
  onNewListNote: () => void;
}

const AddNoteOptions: React.FC<AddNoteOptionsProps> = ({
  onNewTextNote,
  onNewListNote,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          className="fixed bottom-8 right-8 z-50 rounded-full shadow-lg 
                     bg-[hsl(218_4%_39%)] text-white hover:bg-[hsl(218_4%_30%)] 
                     dark:bg-[hsl(240_2%_89%)] dark:text-gray-900 dark:hover:bg-[hsl(240_2%_80%)]
                     transition-all duration-200 h-16 w-16 md:h-12 md:w-12"
          size="icon"
        >
          <Plus className={`h-8 w-8 md:h-6 md:w-6 transition-transform duration-300 ${open ? "rotate-45" : "rotate-0"}`} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-transparent border-none shadow-none flex flex-col items-end gap-2 p-0">
        <DropdownMenuItem onClick={onNewTextNote} className="w-fit text-lg py-3 px-6 bg-foreground dark:bg-foreground border rounded-xl shadow-md cursor-pointer">Text</DropdownMenuItem>
        <DropdownMenuItem onClick={onNewListNote} className="w-fit text-lg py-3 px-6 bg-foreground dark:bg-foreground border rounded-xl shadow-md cursor-pointer">List</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default AddNoteOptions;
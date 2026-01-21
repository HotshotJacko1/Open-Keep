import React from "react";
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="fixed bottom-8 right-8 z-50 p-4 rounded-full shadow-lg 
                     bg-[hsl(218_4%_39%)] text-white hover:bg-[hsl(218_4%_30%)] 
                     dark:bg-[hsl(240_2%_89%)] dark:text-gray-900 dark:hover:bg-[hsl(240_2%_80%)]
                     transition-all duration-200"
          size="icon"
        >
          <Plus className="h-6 w-6" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onNewTextNote}>Text</DropdownMenuItem>
        <DropdownMenuItem onClick={onNewListNote}>List</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default AddNoteOptions;
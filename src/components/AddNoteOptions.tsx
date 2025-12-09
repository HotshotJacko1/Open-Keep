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
  onNewListNote: () => void; // Placeholder for future list note functionality
}

const AddNoteOptions: React.FC<AddNoteOptionsProps> = ({
  onNewTextNote,
  onNewListNote,
}) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="fixed bottom-8 right-8 p-4 rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-200"
          size="icon"
        >
          <Plus className="h-6 w-6" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onNewTextNote}>Text Note</DropdownMenuItem>
        <DropdownMenuItem onClick={onNewListNote}>List Note (Coming Soon)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default AddNoteOptions;
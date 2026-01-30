import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";

interface TopBarProps {
    searchTerm: string;
    onSearchChange: (value: string) => void;
    onSettingsClick: () => void;
    startAdornment?: React.ReactNode; // For Menu Button + Logo/Header Content
    className?: string; // For additional styling
}

const TopBar: React.FC<TopBarProps> = ({
    searchTerm,
    onSearchChange,
    onSettingsClick,
    startAdornment,
    className,
}) => {
    return (
        <div className={cn("flex items-center gap-2 px-4 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))] border-b bg-background sticky top-0 z-50", className)}>
            <div className="flex items-center gap-2 min-w-max">
                {startAdornment}
            </div>

            <Input
                type="text"
                placeholder="Search notes by title, content, or labels..."
                className="flex-grow p-2 rounded-lg shadow focus:ring-2 focus:ring-primary bg-white dark:bg-[#202124] text-card-foreground border-input max-w-3xl mx-auto" // Added max-w and mx-auto for centering style
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
            />

            <Button variant="ghost" size="icon" onClick={onSettingsClick} className="flex-shrink-0">
                <Settings className="h-6 w-6 text-muted-foreground" />
            </Button>
        </div>
    );
};

export default TopBar;

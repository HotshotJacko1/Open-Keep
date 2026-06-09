// Copyright (c) 2026. Licensed under AGPLv3.
import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Settings, CloudSync, Loader2, ArrowUpDown, Check, LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { Capacitor } from "@capacitor/core";
import { useGoogleDrive } from "@/hooks/use-google-drive";
import { useOneDrive } from "@/hooks/use-one-drive";
import { useDropbox } from "@/hooks/use-dropbox";

type SortMode = "recent" | "alphabetical";

interface TopBarProps {
    searchTerm: string;
    onSearchChange: (value: string) => void;
    onSettingsClick: () => void;
    sortMode?: SortMode;
    onSortModeChange?: (mode: SortMode) => void;
    viewMode: "grid" | "list";
    onViewModeChange: (mode: "grid" | "list") => void;
    startAdornment?: React.ReactNode; // For Menu Button + Logo/Header Content
    className?: string; // For additional styling
}

const TopBar: React.FC<TopBarProps> = ({
    searchTerm,
    onSearchChange,
    onSettingsClick,
    sortMode = "recent",
    onSortModeChange,
    viewMode,
    onViewModeChange,
    startAdornment,
    className,
}) => {
    const googleDrive = useGoogleDrive();
    const oneDrive = useOneDrive();
    const dropbox = useDropbox();

    const activeService = React.useMemo(() => {
        if (googleDrive.isConnected) return { ...googleDrive, name: "Google Drive" };
        if (oneDrive.isConnected) return { ...oneDrive, name: "OneDrive" };
        if (dropbox.isConnected) return { ...dropbox, name: "Dropbox" };
        return null;
    }, [googleDrive.isConnected, oneDrive.isConnected, dropbox.isConnected, googleDrive, oneDrive, dropbox]);

    const handleSync = async () => {
        if (!activeService) return;
        const result = await activeService.sync();
        if (result && result.status === "conflict" && 'cloudPayload' in result) {
            window.dispatchEvent(new CustomEvent('open-sync-conflict', { 
                detail: { 
                    service: activeService.name.toLowerCase().replace(' ', ''), 
                    payload: (result as any).cloudPayload, 
                    reason: (result as any).reason 
                } 
            }));
        }
    };

    const isWeb = Capacitor.getPlatform() === 'web';
    const showSyncButton = isWeb && activeService;

    return (
        <div className={cn("flex items-center gap-2 px-4 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))] border-b bg-background sticky top-0 z-50", className)}>
            <div className="flex items-center gap-2 min-w-max">
                {startAdornment}
            </div>

            <div className="relative flex-grow max-w-3xl mx-auto">
                <Input
                    type="text"
                    placeholder="Search"
                    className="w-full p-2 rounded-lg shadow focus:ring-2 focus:ring-primary bg-white dark:bg-[#202124] text-card-foreground border-input pr-10"
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                />
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            >
                                <ArrowUpDown className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem
                                onClick={() => onSortModeChange?.("recent")}
                                className="flex items-center justify-between"
                            >
                                <span>Recent</span>
                                {sortMode === "recent" && <Check className="h-4 w-4" />}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => onSortModeChange?.("alphabetical")}
                                className="flex items-center justify-between"
                            >
                                <span>Alphabetical</span>
                                {sortMode === "alphabetical" && <Check className="h-4 w-4" />}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => onViewModeChange(viewMode === "grid" ? "list" : "grid")}
                    >
                        {viewMode === "grid" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
                    </Button>
                </div>
            </div>

            {showSyncButton && (
                <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleSync} 
                    disabled={activeService.isSyncing} 
                    className="flex-shrink-0 text-muted-foreground"
                >
                    {activeService.isSyncing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <CloudSync className="mr-2 h-4 w-4" />
                    )}
                    {activeService.isSyncing ? "Syncing..." : "Sync"}
                </Button>
            )}

            <Button variant="ghost" size="icon" onClick={onSettingsClick} className="flex-shrink-0">
                <Settings className="h-6 w-6 text-muted-foreground" />
            </Button>
        </div>
    );
};

export default TopBar;

// Copyright (c) 2026. Licensed under AGPLv3.
import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Settings, CloudSync, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Capacitor } from "@capacitor/core";
import { useGoogleDrive } from "@/hooks/use-google-drive";
import { useOneDrive } from "@/hooks/use-one-drive";
import { useDropbox } from "@/hooks/use-dropbox";

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

            <Input
                type="text"
                placeholder="Search notes by title, content, or labels..."
                className="flex-grow p-2 rounded-lg shadow focus:ring-2 focus:ring-primary bg-white dark:bg-[#202124] text-card-foreground border-input max-w-3xl mx-auto" // Added max-w and mx-auto for centering style
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
            />

            {showSyncButton && (
                <Button 
                    variant="outline" 
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

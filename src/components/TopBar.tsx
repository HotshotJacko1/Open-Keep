// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Settings, CloudSync } from "lucide-react";
import { cn } from "@/lib/utils";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { syncNotes } from "@/lib/sync";
import { toast } from "sonner";

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
    const [isSyncConfigured, setIsSyncConfigured] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const isWeb = Capacitor.getPlatform() === 'web';

    useEffect(() => {
        const checkSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setIsSyncConfigured(!!session);
        };
        checkSession();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setIsSyncConfigured(!!session);
        });

        return () => subscription.unsubscribe();
    }, []);

    const handleSync = async () => {
        setIsSyncing(true);
        try {
            await syncNotes();
            toast.success("Sync completed successfully");
        } catch (error: any) {
            console.error("Sync error:", error);
            toast.error(`Sync failed: ${error.message || "Unknown error"}`);
        } finally {
            setIsSyncing(false);
        }
    };

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

            {isWeb && isSyncConfigured && (
                <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={handleSync} 
                    disabled={isSyncing}
                    className="flex-shrink-0"
                    title="Sync now"
                >
                    <CloudSync className={cn("h-6 w-6 text-muted-foreground", isSyncing && "animate-spin")} />
                </Button>
            )}

            <Button variant="ghost" size="icon" onClick={onSettingsClick} className="flex-shrink-0">
                <Settings className="h-6 w-6 text-muted-foreground" />
            </Button>
        </div>
    );
};

export default TopBar;
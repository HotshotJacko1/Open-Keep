// Copyright (c) 2026. Licensed under AGPLv3.
import { useEffect, useState } from "react";
import { Power, PanelBottomClose } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { showError } from "@/utils/toast";
import { AutostartState, getAutostart, setAutostart, setStartMinimised } from "@/lib/desktop-autostart";

/** Settings → Startup, in the Windows desktop app only. */
const DesktopStartupSettings = () => {
    const [state, setState] = useState<AutostartState | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let cancelled = false;
        getAutostart()
            .then((s) => { if (!cancelled) setState(s); })
            .catch((e) => console.warn("Could not read launch at startup:", e));
        return () => { cancelled = true; };
    }, []);

    if (!state) return null;

    const handleToggleLaunch = async (enabled: boolean) => {
        setBusy(true);
        try {
            const next = await setAutostart(enabled);
            setState(next);
            if (next.enabled !== enabled && next.managedByWindows) {
                showError("Windows Settings controls this. Change it in Settings → Apps → Startup.");
            }
        } catch (e) {
            showError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const handleToggleMinimised = async (minimised: boolean) => {
        setState({ ...state, startMinimised: minimised });
        try {
            await setStartMinimised(minimised);
        } catch (e) {
            setState({ ...state, startMinimised: !minimised });
            showError(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <div className="flex flex-col gap-2 mt-4">
            <Label>Startup</Label>
            <div className="flex flex-col rounded-md border border-input text-sm font-medium">
                <div className="flex items-center justify-between gap-4 px-4 py-2 min-h-10">
                    <div className="space-y-0.5">
                        <label htmlFor="launch-at-startup" className="flex items-center gap-2 cursor-pointer">
                            <Power className="h-4 w-4 mr-2" />
                            Launch at Startup
                        </label>
                        {state.managedByWindows && (
                            <p className="text-xs font-normal text-muted-foreground ml-8">
                                Set in Windows Settings → Apps → Startup
                            </p>
                        )}
                    </div>
                    <Switch
                        id="launch-at-startup"
                        checked={state.enabled}
                        disabled={busy || state.managedByWindows}
                        onCheckedChange={handleToggleLaunch}
                    />
                </div>
                <div className="flex items-center justify-between gap-4 px-4 py-2 min-h-10 border-t border-input">
                    <div className={`space-y-0.5 pl-6 ${state.enabled ? "" : "opacity-50"}`}>
                        <label htmlFor="start-minimised" className="flex items-center gap-2 cursor-pointer">
                            <PanelBottomClose className="h-4 w-4 mr-2" />
                            Start Minimised
                        </label>
                        <p className="text-xs font-normal text-muted-foreground ml-8">
                            Start in the system tray, without opening the window
                        </p>
                    </div>
                    <Switch
                        id="start-minimised"
                        checked={state.startMinimised}
                        disabled={!state.enabled}
                        onCheckedChange={handleToggleMinimised}
                    />
                </div>
            </div>
        </div>
    );
};

export default DesktopStartupSettings;

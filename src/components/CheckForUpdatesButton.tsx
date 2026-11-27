// Copyright (c) 2026. Licensed under AGPLv3.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { canCheckForUpdates, findUpdate, type UpdateCheckResult } from "@/lib/desktop-updater";

const MESSAGES: Record<Exclude<UpdateCheckResult["status"], "available">, string> = {
    none: "You're on the latest version.",
    failed: "Couldn't check for updates. Are you online?",
    installing: "The update is downloading.",
};

/**
 * Settings → under App Version, in the GitHub `.exe` version only (the Store,
 * web and phone versions are updated by their stores). The same check the app
 * runs daily, with the answer shown here.
 */
const CheckForUpdatesButton = () => {
    const [visible, setVisible] = useState(false);
    const [checking, setChecking] = useState(false);
    const [result, setResult] = useState<UpdateCheckResult | null>(null);

    useEffect(() => {
        let cancelled = false;
        void canCheckForUpdates().then((can) => { if (!cancelled) setVisible(can); });
        return () => { cancelled = true; };
    }, []);

    if (!visible) return null;

    const handleCheck = async () => {
        setChecking(true);
        setResult(null);
        setResult(await findUpdate());
        setChecking(false);
    };

    const handleInstall = async () => {
        if (result?.status !== "available") return;
        setResult({ status: "installing" });
        // On success the installer closes the app, so this only returns after a
        // failure, which install() reports in a toast.
        await result.install();
        setResult(null);
    };

    return (
        <div className="flex items-center justify-between gap-4 mt-1">
            <span className="text-xs text-muted-foreground" aria-live="polite">
                {result?.status === "available"
                    ? `Version ${result.version} is available.`
                    : result ? MESSAGES[result.status] : ""}
            </span>
            {result?.status === "available" ? (
                <Button size="sm" onClick={() => void handleInstall()}>Restart to update</Button>
            ) : (
                <Button size="sm" variant="outline" onClick={handleCheck} disabled={checking || result?.status === "installing"}>
                    {checking ? "Checking…" : "Check for updates"}
                </Button>
            )}
        </div>
    );
};

export default CheckForUpdatesButton;

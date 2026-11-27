// Copyright (c) 2026. Licensed under AGPLv3.
import { useEffect, useState } from "react";
import { MonitorDown, Download } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { getInstallOption, subscribeInstallOption, InstallOption, WINDOWS_APP_URL } from "@/lib/pwa";

/**
 * Settings → App, in desktop browsers. On Windows it offers the Windows app
 * first, with installing the web app as a smaller second choice. Elsewhere it
 * offers the web app: Chrome and Edge through their install prompt, Safari on
 * a Mac through Add to Dock. Hidden once running installed, and on phones,
 * which have the store apps.
 */
const InstallAppSettings = () => {
    const [option, setOption] = useState<InstallOption | null>(getInstallOption);

    useEffect(() => subscribeInstallOption(() => setOption(getInstallOption())), []);

    if (!option) return null;

    return (
        <div className="flex flex-col gap-2 mt-4">
            <Label>App</Label>
            {option.windowsApp && (
                <Button
                    variant="outline"
                    onClick={() => window.open(WINDOWS_APP_URL, "_blank")}
                    className="w-full justify-start"
                >
                    <Download className="h-4 w-4 mr-2" />
                    Get the Windows App
                </Button>
            )}
            {option.install && (option.windowsApp ? (
                <Button
                    variant="link"
                    onClick={() => void option.install?.()}
                    className="h-auto self-start px-4 py-0 text-xs text-brand underline"
                >
                    or install the web app
                </Button>
            ) : (
                <Button variant="outline" onClick={() => void option.install?.()} className="w-full justify-start">
                    <MonitorDown className="h-4 w-4 mr-2" />
                    Install Open Keep as an App
                </Button>
            ))}
            {option.safari && (
                <div className="flex items-start gap-2 rounded-md border border-input px-4 py-2 text-sm">
                    <MonitorDown className="h-4 w-4 mr-2 mt-0.5 shrink-0" />
                    <span>
                        To install Open Keep as an app, choose <strong>File → Add to Dock</strong> in Safari's menu bar.
                        {/* Safari gives Dock apps their own storage, separate from its tabs. */}
                        <span className="block text-xs text-muted-foreground mt-1">
                            The app keeps its own copy of your notes: turn on sync to bring them across.
                        </span>
                    </span>
                </div>
            )}
        </div>
    );
};

export default InstallAppSettings;

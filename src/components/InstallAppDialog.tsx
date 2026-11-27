// Copyright (c) 2026. Licensed under AGPLv3.
import { useEffect, useState } from "react";
import { MonitorDown, Download, Smartphone } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    clearInstallRequest,
    getInstallHelp,
    InstallHelp,
    isInstallRequested,
    subscribeInstallOption,
    WINDOWS_APP_URL,
} from "@/lib/pwa";

const SYNC_NOTE = "The installed app keeps its own copy of your notes: turn on sync to bring them across.";

/**
 * The box the install link (app.openkeep.net/install, e.g. from the website)
 * opens: install steps for this browser, the Windows app on Windows, or the
 * store app on phones. Shown once per visit to the link.
 */
const InstallAppDialog = () => {
    const [open, setOpen] = useState(() => isInstallRequested() && getInstallHelp() !== null);
    // Chrome and Edge can offer their install prompt a moment after the page loads.
    const [help, setHelp] = useState<InstallHelp | null>(getInstallHelp);

    useEffect(() => subscribeInstallOption(() => setHelp(getInstallHelp())), []);

    const close = () => {
        clearInstallRequest();
        setOpen(false);
    };

    const installWebApp = async (install: () => Promise<void>) => {
        await install();
        close();
    };

    if (!help) return null;

    let icon = <MonitorDown className="h-5 w-5 text-brand" />;
    let body: React.ReactNode;
    let action: React.ReactNode = null;

    switch (help.kind) {
        case "prompt":
            body = <p>Open Keep gets its own window and icon, and opens even when you're offline.</p>;
            action = <Button onClick={() => void installWebApp(help.install)}>Install</Button>;
            break;
        case "windows":
            icon = <Download className="h-5 w-5 text-brand" />;
            body = (
                <>
                    <p>
                        The Windows app keeps your notes in an encrypted file on your PC, and can connect
                        to AI tools.
                    </p>
                    {help.install && (
                        <p>
                            Or{" "}
                            <Button
                                variant="link"
                                onClick={() => void installWebApp(help.install!)}
                                className="h-auto p-0 align-baseline text-brand underline"
                            >
                                install the web app
                            </Button>{" "}
                            from this browser instead.
                        </p>
                    )}
                </>
            );
            action = (
                <Button onClick={() => { window.open(WINDOWS_APP_URL, "_blank"); close(); }}>
                    Get the Windows App
                </Button>
            );
            break;
        case "safari":
            body = (
                <>
                    <p>
                        In Safari's menu bar, choose <strong>File → Add to Dock</strong>. Open Keep gets its own
                        window and icon, and opens even when you're offline.
                    </p>
                    <p className="text-muted-foreground">{SYNC_NOTE}</p>
                </>
            );
            break;
        case "chromium":
            body = (
                <>
                    <p>
                        Click the install icon at the right of the address bar. If there isn't one, Open Keep
                        may already be installed: look for it in your apps.
                    </p>
                </>
            );
            break;
        case "firefox":
            body = (
                <p>
                    Firefox can't install web apps. Open this page in Chrome or Edge to install Open Keep,
                    or keep using it here in Firefox.
                </p>
            );
            break;
        case "phone":
            icon = <Smartphone className="h-5 w-5 text-brand" />;
            body = <p>On phones and tablets, get Open Keep from {help.storeName}.</p>;
            action = (
                <Button onClick={() => { window.open(help.storeUrl, "_blank"); close(); }}>
                    Open {help.storeName}
                </Button>
            );
            break;
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
            <DialogContent className="w-[calc(100%-2rem)] sm:max-w-[425px] max-h-[85dvh] overflow-y-auto rounded-dialog">
                <DialogHeader>
                    <div className="flex items-center gap-2 mb-1">
                        {icon}
                        <DialogTitle className="text-text-primary dark:text-text-primary">Install Open Keep</DialogTitle>
                    </div>
                    <DialogDescription asChild>
                        <div className="pt-2 text-sm text-text-primary dark:text-text-primary space-y-3">{body}</div>
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex-row justify-end gap-2 pt-4">
                    <Button variant="text" onClick={close}>
                        {action ? "Not now" : "Got it"}
                    </Button>
                    {action}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default InstallAppDialog;

import { useEffect, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

const pendingWidgetUrlKey = "openkeep.pendingWidgetUrl";

export type WidgetAction =
  | { type: "new-text" }
  | { type: "new-list" }
  | { type: "open-note"; noteId: string }
  | { type: "toggle-checkbox"; noteId: string; lineIndex: number }
  | null;

/**
 * Hook that listens for incoming deep links from the OS widget (or any
 * openkeep:// URL) and returns the parsed action.
 *
 * Returns `null` when idle, or an action object when a corresponding deep
 * link is received. The action resets to `null` after the calling component
 * consumes it by calling `clearAction()`.
 */
export function useWidgetDeepLink() {
  const [action, setAction] = useState<WidgetAction>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handleUrl = (url: string) => {
      if (!url) return;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "openkeep:") return;

        const host = parsed.hostname || parsed.host;
        const pathParts = parsed.pathname.replace(/^\//, "").split("/").filter(Boolean);

        if (host === "new-text") {
          handledRef.current = true;
          localStorage.removeItem(pendingWidgetUrlKey);
          setAction({ type: "new-text" });
        } else if (host === "new-list") {
          handledRef.current = true;
          localStorage.removeItem(pendingWidgetUrlKey);
          setAction({ type: "new-list" });
        } else if (host === "open-note" && pathParts.length > 0) {
          handledRef.current = true;
          localStorage.removeItem(pendingWidgetUrlKey);
          setAction({ type: "open-note", noteId: pathParts[0] });
        } else if (host === "toggle-checkbox" && pathParts.length >= 2) {
          handledRef.current = true;
          localStorage.removeItem(pendingWidgetUrlKey);
          setAction({
            type: "toggle-checkbox",
            noteId: pathParts[0],
            lineIndex: parseInt(pathParts[1], 10),
          });
        }
      } catch {
        // Not a valid URL — ignore
      }
    };

    const handleNativeReplay = (event: Event) => {
      const url = (event as CustomEvent<{ url?: string }>).detail?.url;
      if (url) {
        handleUrl(url);
      }
    };

    window.addEventListener("openkeep-widget-url", handleNativeReplay);

    const pendingUrl = localStorage.getItem(pendingWidgetUrlKey);
    if (pendingUrl) {
      handleUrl(pendingUrl);
    }

    // Check initial launch URL (cold start)
    App.getLaunchUrl().then((launch) => {
      if (launch?.url) {
        handleUrl(launch.url);
      }
    });

    const handler = App.addListener("appUrlOpen", (event) => {
      handleUrl(event.url);
    });

    return () => {
      window.removeEventListener("openkeep-widget-url", handleNativeReplay);
      handler.then((h) => h.remove());
    };
  }, []);

  const clearAction = () => {
    handledRef.current = false;
    setAction(null);
  };

  return { action, clearAction };
}

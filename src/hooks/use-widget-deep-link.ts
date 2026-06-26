import { useEffect, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

export type WidgetAction = "new-text" | "new-list" | null;

/**
 * Hook that listens for incoming deep links from the OS widget (or any
 * openkeep:// URL) and returns the parsed action.
 *
 * Returns `null` when idle, or `"new-text"` / `"new-list"` when a
 * corresponding deep link is received. The action resets to `null` after
 * the calling component consumes it by calling `clearAction()`.
 */
export function useWidgetDeepLink() {
  const [action, setAction] = useState<WidgetAction>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handler = App.addListener("appUrlOpen", (event) => {
      const url = event.url;
      if (!url) return;

      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "openkeep:") return;

        const host = parsed.hostname || parsed.host;

        if (host === "new-text") {
          handledRef.current = true;
          setAction("new-text");
        } else if (host === "new-list") {
          handledRef.current = true;
          setAction("new-list");
        }
      } catch {
        // Not a valid URL — ignore
      }
    });

    return () => {
      handler.then((h) => h.remove());
    };
  }, []);

  const clearAction = () => {
    handledRef.current = false;
    setAction(null);
  };

  return { action, clearAction };
}
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

type ActionListener = (action: WidgetAction) => void;

const actionListeners = new Set<ActionListener>();
let nativeListenersReady = false;

/**
 * Parse openkeep:// widget URLs.
 * Supports both host form (openkeep://new-text) and path form (openkeep:///new-text).
 */
export function parseWidgetDeepLink(url: string): WidgetAction {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "openkeep:") return null;

    const host = (parsed.hostname || parsed.host || "").toLowerCase();
    const pathParts = parsed.pathname.replace(/^\//, "").split("/").filter(Boolean);

    // openkeep://new-text  → host=new-text
    // openkeep:///new-text → host="", path=["new-text"]
    const actionType = host || pathParts[0] || "";
    const rest = host ? pathParts : pathParts.slice(1);

    if (actionType === "new-text") {
      return { type: "new-text" };
    }
    if (actionType === "new-list") {
      return { type: "new-list" };
    }
    if (actionType === "open-note" && rest[0]) {
      return { type: "open-note", noteId: rest[0] };
    }
    if (actionType === "toggle-checkbox" && rest.length >= 2) {
      return {
        type: "toggle-checkbox",
        noteId: rest[0],
        lineIndex: parseInt(rest[1], 10),
      };
    }
  } catch {
    // Not a valid URL — ignore
  }

  return null;
}

function persistAndNotify(url: string) {
  const parsedAction = parseWidgetDeepLink(url);
  if (!parsedAction) return;

  // Keep pending until the UI successfully consumes it via clearPendingWidgetDeepLink().
  localStorage.setItem(pendingWidgetUrlKey, url);
  actionListeners.forEach((listener) => listener(parsedAction));
}

function handleNativeReplay(event: Event) {
  const url = (event as CustomEvent<{ url?: string }>).detail?.url;
  if (url) {
    persistAndNotify(url);
  }
}

/**
 * Start capturing widget/OAuth-unrelated openkeep:// URLs as soon as the app loads,
 * even while the lock screen is showing and Index is unmounted.
 */
export function ensureWidgetDeepLinkCapture() {
  if (!Capacitor.isNativePlatform() || nativeListenersReady) return;
  nativeListenersReady = true;

  window.addEventListener("openkeep-widget-url", handleNativeReplay);

  const pendingUrl = localStorage.getItem(pendingWidgetUrlKey);
  if (pendingUrl) {
    persistAndNotify(pendingUrl);
  }

  App.getLaunchUrl()
    .then((launch) => {
      if (launch?.url) {
        persistAndNotify(launch.url);
      }
    })
    .catch(() => {
      // Ignore launch URL errors
    });

  void App.addListener("appUrlOpen", (event) => {
    persistAndNotify(event.url);
  });
}

export function clearPendingWidgetDeepLink() {
  localStorage.removeItem(pendingWidgetUrlKey);
}

export function readPendingWidgetAction(): WidgetAction {
  const pendingUrl = localStorage.getItem(pendingWidgetUrlKey);
  return pendingUrl ? parseWidgetDeepLink(pendingUrl) : null;
}

/**
 * Hook that listens for incoming deep links from the OS widget (or any
 * openkeep:// URL) and returns the parsed action.
 *
 * The raw URL stays in localStorage until clearAction() so cold starts and
 * lock-screen unlocks can still consume it after Index mounts.
 */
export function useWidgetDeepLink() {
  const [action, setAction] = useState<WidgetAction>(() => readPendingWidgetAction());
  const handledRef = useRef(false);

  useEffect(() => {
    ensureWidgetDeepLinkCapture();

    const onAction: ActionListener = (parsedAction) => {
      handledRef.current = true;
      setAction(parsedAction);
    };

    actionListeners.add(onAction);

    // Re-read in case a URL arrived before this subscriber mounted.
    const pending = readPendingWidgetAction();
    if (pending) {
      handledRef.current = true;
      setAction(pending);
    }

    return () => {
      actionListeners.delete(onAction);
    };
  }, []);

  const clearAction = () => {
    handledRef.current = false;
    clearPendingWidgetDeepLink();
    setAction(null);
  };

  return { action, clearAction };
}

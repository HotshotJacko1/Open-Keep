// Copyright (c) 2026. Licensed under AGPLv3.
// Must stay the first import: it patches built-ins before any dependency evaluates.
import "./polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Google Sans Flex (weight axis), bundled from npm so it is never fetched from Google.
import "@fontsource-variable/google-sans-flex";
// Vazirmatn, for the Persian/Arabic letters Google Sans Flex lacks (see --font-sans).
import "@fontsource-variable/vazirmatn";
import "./globals.css";
import { ThemeProvider } from "./context/theme-provider";
import { SessionContextProvider } from "./context/session-provider";
import { GoogleOAuthProvider } from "@react-oauth/google";
import * as Sentry from "@sentry/capacitor";
import * as SentryReact from "@sentry/react";
import { Capacitor } from "@capacitor/core";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

// Session Replay — 10% of sessions, 100% of sessions with errors.
// CapacitorOptions omits these, but Sentry.init forwards every option to the
// sibling SentryReact.init, which is where replay reads them.
const replayOptions: Pick<SentryReact.BrowserOptions, "replaysSessionSampleRate" | "replaysOnErrorSampleRate"> = {
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
};

function isLocalDevSession(): boolean {
  if (import.meta.env.DEV) return true;
  if (Capacitor.isNativePlatform()) return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || /Electron|dyad\//i.test(navigator.userAgent);
}

// Error reporting starts once the notes are on screen (Index.tsx fires
// NOTES_SHOWN_EVENT), or after 3s if they never are (e.g. the lock screen). Starting
// it at boot held up the first database call: Capacitor runs plugin calls on one
// thread, and the native SDK's init went first. Errors thrown before then are kept
// and reported once it starts, so startup failures still reach Sentry.
const NOTES_SHOWN_EVENT = "open-keep-notes-shown";
const earlyErrors: unknown[] = [];
const recordEarlyError = (event: ErrorEvent) => earlyErrors.push(event.error ?? event.message);
const recordEarlyRejection = (event: PromiseRejectionEvent) => earlyErrors.push(event.reason);
window.addEventListener("error", recordEarlyError);
window.addEventListener("unhandledrejection", recordEarlyRejection);

let errorReportingStarted = false;
const startErrorReporting = () => {
  if (errorReportingStarted) return;
  errorReportingStarted = true;
  window.removeEventListener("error", recordEarlyError);
  window.removeEventListener("unhandledrejection", recordEarlyRejection);

  Sentry.init(
    {
      dsn: import.meta.env.VITE_SENTRY_DSN,
      // Label dev/Dyad sessions so they can be filtered out of prod alerts.
      // MODE alone isn't enough: Dyad serves a `vite build` (MODE "production")
      // on localhost inside Electron. Native apps are also served from localhost,
      // so the host check only applies off-native.
      environment: isLocalDevSession() ? "development" : import.meta.env.MODE,
      integrations: [
        // Use Sentry.browserTracingIntegration from @sentry/capacitor (not @sentry/react)
        Sentry.browserTracingIntegration(),
        // Session Replay is added below, once its code has loaded.
      ],
      // Tracing — 10% of transactions keeps startup fast and quota sane
      tracesSampleRate: 0.1,
      // Deliberately excludes the Supabase domain: Sentry's trace headers
      // (baggage/traceparent) trigger a CORS preflight that edge functions
      // reject, which blocked the google-token-exchange call.
      tracePropagationTargets: ["localhost"],
      ...replayOptions,
      // Send console logs to Sentry
      enableLogs: false,
    },
    // Forward the init method from @sentry/react
    SentryReact.init
  );

  earlyErrors.forEach((error) => Sentry.captureException(error));
  void import("./lib/sentry-replay").then(({ replayIntegration }) => {
    SentryReact.addIntegration(replayIntegration());
  });
};
window.addEventListener(NOTES_SHOWN_EVENT, startErrorReporting, { once: true });
setTimeout(startErrorReporting, 3000);

// A failed first read of the native database is caught (App.tsx recovers from it),
// so it never reaches the listeners above. Report it explicitly: it's the failure
// that makes notes look gone, and without it the native error was only logged.
const reportError = (error: unknown) => {
  if (errorReportingStarted) Sentry.captureException(error);
  else earlyErrors.push(error);
};
window.addEventListener("open-keep-db-unverified", (event) => {
  reportError((event as CustomEvent).detail ?? new Error("First database read failed"));
});

// After a web deploy, a tab opened on the previous one still asks for the old
// hashed chunks (NoteEditor, Settings...). They are gone, Vercel's catch-all
// answers with index.html, and the dynamic import fails. Reload onto the new
// build instead, at most once a minute so a real outage can't loop (C4-17).
const PRELOAD_RELOAD_KEY = "open-keep-preload-reload-at";
window.addEventListener("vite:preloadError", (event) => {
  try {
    const last = Number(sessionStorage.getItem(PRELOAD_RELOAD_KEY) || 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

// iOS WebKit only applies :active on touch when a touchstart listener exists
// somewhere on the page. The .press-feedback tint (globals.css) relies on it.
document.addEventListener("touchstart", () => {}, { passive: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || "889284625804-5prnhudcoalopvn0ad0au449lo1bn8f8.apps.googleusercontent.com"}>
      <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
        <AppErrorBoundary onError={reportError}>
          <SessionContextProvider>
            <App />
          </SessionContextProvider>
        </AppErrorBoundary>
      </ThemeProvider>
    </GoogleOAuthProvider>
  </React.StrictMode>
);
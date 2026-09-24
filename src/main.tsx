// Copyright (c) 2026. Licensed under AGPLv3.
// Must stay the first import: it patches built-ins before any dependency evaluates.
import "./polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./globals.css";
import { ThemeProvider } from "./context/theme-provider";
import { SessionContextProvider } from "./context/session-provider";
import { GoogleOAuthProvider } from "@react-oauth/google";
import * as Sentry from "@sentry/capacitor";
import * as SentryReact from "@sentry/react";
import { Capacitor } from "@capacitor/core";

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
      // Session Replay. Must come from @sentry/react - unlike
      // browserTracingIntegration, @sentry/capacitor does not re-export
      // replayIntegration, so Sentry.replayIntegration is undefined.
      SentryReact.replayIntegration(),
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || "889284625804-5prnhudcoalopvn0ad0au449lo1bn8f8.apps.googleusercontent.com"}>
      <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
        <SessionContextProvider>
          <App />
        </SessionContextProvider>
      </ThemeProvider>
    </GoogleOAuthProvider>
  </React.StrictMode>
);
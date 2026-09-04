// Copyright (c) 2026. Licensed under AGPLv3.
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./globals.css";
import { ThemeProvider } from "./context/theme-provider";
import { SessionContextProvider } from "./context/session-provider";
import { GoogleOAuthProvider } from "@react-oauth/google";
import * as Sentry from "@sentry/capacitor";
import * as SentryReact from "@sentry/react";

Sentry.init(
  {
    dsn: import.meta.env.VITE_SENTRY_DSN,
    // Label dev/Dyad sessions so they can be filtered out of prod alerts.
    // Vite MODE is "development" for vite dev, "production" for vite build.
    environment: import.meta.env.MODE,
    integrations: [
      // Use Sentry.browserTracingIntegration from @sentry/capacitor (not @sentry/react)
      Sentry.browserTracingIntegration(),
    ],
    // Tracing — 10% of transactions keeps startup fast and quota sane
    tracesSampleRate: 0.1,
    // Deliberately excludes the Supabase domain: Sentry's trace headers
    // (baggage/traceparent) trigger a CORS preflight that edge functions
    // reject, which blocked the google-token-exchange call.
    tracePropagationTargets: ["localhost"],
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
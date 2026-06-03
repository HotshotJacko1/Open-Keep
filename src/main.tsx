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
    integrations: [
      // Use Sentry.browserTracingIntegration from @sentry/capacitor (not @sentry/react)
      Sentry.browserTracingIntegration(),
    ],
    // Tracing — capture 100% of transactions (tune down in production if needed)
    tracesSampleRate: 1.0,
    // Distributed tracing targets
    tracePropagationTargets: ["localhost", /^https:\/\/qrckwhokwhgwnfpsnude\.supabase\.co/],
    // Send console logs to Sentry
    enableLogs: true,
  },
  // Forward the init method from @sentry/react
  SentryReact.init
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
      <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
        <SessionContextProvider>
          <App />
        </SessionContextProvider>
      </ThemeProvider>
    </GoogleOAuthProvider>
  </React.StrictMode>
);
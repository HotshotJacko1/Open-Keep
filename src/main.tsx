// Copyright (c) 2026. Licensed under AGPLv3.
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./globals.css";
import { ThemeProvider } from "./context/theme-provider";
import { SessionContextProvider } from "./context/session-provider";

import { GoogleOAuthProvider } from "@react-oauth/google";

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
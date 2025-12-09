import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./globals.css";
import { ThemeProvider } from "./context/theme-provider";
import { SessionContextProvider } from "./context/session-provider";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <SessionContextProvider>
        <App />
      </SessionContextProvider>
    </ThemeProvider>
  </React.StrictMode>
);
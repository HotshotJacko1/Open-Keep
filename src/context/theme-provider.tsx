// Copyright (c) 2026. Licensed under AGPLv3.
import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";

const THEMES = ["dark", "light", "system"] as const;

type Theme = (typeof THEMES)[number];

const isTheme = (value: unknown): value is Theme =>
  typeof value === "string" && (THEMES as readonly string[]).includes(value);

// Reading localStorage can throw (disabled storage / restricted WebView), and the
// stored value is untrusted: anything that is not a known Theme must not reach the
// <html> class list, or the app lands in neither "light" nor "dark" and falls back
// to whatever the CSS defaults to.
const readStoredTheme = (storageKey: string, fallback: Theme): Theme => {
  try {
    const stored = localStorage.getItem(storageKey);
    return isTheme(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}) {
  const [theme, setTheme] = useState<Theme>(() =>
    readStoredTheme(storageKey, defaultTheme)
  );

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

    if (theme === "system") {
      // Follow OS light/dark switches while the app is open, not just at mount.
      const query = window.matchMedia("(prefers-color-scheme: dark)");
      const applySystemTheme = () => {
        root.classList.remove("light", "dark");
        root.classList.add(query.matches ? "dark" : "light");
      };

      applySystemTheme();
      // Safari < 14 only has the deprecated addListener/removeListener.
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", applySystemTheme);
        return () => query.removeEventListener("change", applySystemTheme);
      }
      query.addListener(applySystemTheme);
      return () => query.removeListener(applySystemTheme);
    }

    root.classList.add(theme);
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      try {
        localStorage.setItem(storageKey, theme);
      } catch {
        // Persisting the choice is best-effort; it must not break the theme switch.
      }
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
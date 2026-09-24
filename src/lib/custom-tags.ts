// Copyright (c) 2026. Licensed under AGPLv3.

// A corrupt or non-array "custom-tags" value used to white-screen the app (when
// parsed unguarded in Index) and to break every cloud sync permanently (when
// parsed in the sync hooks). Guard every read through here. Note the
// Array.isArray check matters as much as the try/catch — JSON.parse("5")
// succeeds and returns a number, which then blows up on the first spread or .map.
export const readCustomTags = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem("custom-tags") ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
};

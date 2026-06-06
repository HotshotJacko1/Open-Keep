// Copyright (c) 2026. Licensed under AGPLv3.

/** Normalize master key payloads that may be JSON-stringified or have stray whitespace. */
export const normalizeCloudMasterKeyPayload = (raw: string | null | undefined): string | null => {
    if (!raw) return null;

    let payload = raw.trim();
    if (!payload) return null;

    if (payload.startsWith('"') && payload.endsWith('"')) {
        try {
            const parsed = JSON.parse(payload);
            if (typeof parsed === "string") {
                payload = parsed;
            }
        } catch {
            // Keep original payload if it isn't valid JSON.
        }
    }

    return payload;
};

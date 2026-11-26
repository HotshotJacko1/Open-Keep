// Copyright (c) 2026. Licensed under AGPLv3.
//
// Google Drive sign-in for the desktop app. Google's web sign-in (the GIS popup
// the web app uses) can't open in the desktop app, and Google blocks sign-in
// inside embedded webviews, so this runs in the user's default browser:
//
//   1. A one-request listener starts on 127.0.0.1 (tauri-plugin-oauth), on the
//      first free port of DESKTOP_REDIRECT_PORTS.
//   2. Google's consent page opens in the default browser with that listener
//      as redirect_uri, for the same web OAuth client the web app uses.
//   3. Google redirects back to the listener with ?code=...&state=...
//   4. The caller exchanges the code through the google-token-exchange Supabase
//      function, exactly like the web app, so no client secret ships in the app.
//
// Each http://127.0.0.1:<port> below must be listed under "Authorized redirect
// URIs" on the web OAuth client in Google Cloud Console (web clients need exact
// URIs, ports included).

import { openInSystemBrowser } from "./platform";

export const DESKTOP_REDIRECT_PORTS = [44257, 44258, 44259];

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

// Plain ASCII: the plugin sends it with a byte-count Content-Length.
const DONE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Open Keep</title>
<style>body{font-family:system-ui,sans-serif;background:#1f1a16;color:#f2ede8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
main{text-align:center;max-width:28rem;padding:2rem}h1{font-size:1.4rem;margin:0 0 .5rem}p{color:#c9bfb5;margin:0}</style></head>
<body><main><h1>Signed in to Google</h1><p>You can close this tab and go back to Open Keep.</p></main></body></html>`;

const randomState = (): string => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * Runs the browser sign-in and returns Google's one-time code with the
 * redirect URI it was issued for (the token exchange must send the same one).
 */
export const signInWithGoogleOnDesktop = async (
    clientId: string,
    scopes: string[],
    loginHint?: string,
): Promise<{ code: string; redirectUri: string }> => {
    const { start, cancel, onUrl } = await import("@fabianlars/tauri-plugin-oauth");

    let port: number;
    try {
        port = await start({ ports: DESKTOP_REDIRECT_PORTS, response: DONE_PAGE });
    } catch (error) {
        throw new Error(
            `Couldn't start Google sign-in: ports ${DESKTOP_REDIRECT_PORTS.join(", ")} are all in use on this computer.`,
            { cause: error },
        );
    }
    const redirectUri = `http://127.0.0.1:${port}`;
    const state = randomState();

    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        // Listen before opening the browser, so a fast redirect can't be missed.
        const redirected = new Promise<string>((resolve, reject) => {
            onUrl(resolve).then((stop) => { unlisten = stop; }, reject);
            timer = setTimeout(() => reject(new Error("Google sign-in timed out. Try again.")), SIGN_IN_TIMEOUT_MS);
        });

        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authUrl.search = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: scopes.join(" "),
            // A refresh token, so later syncs don't need the browser. Google only
            // returns one with consent, so ask for it every interactive sign-in.
            access_type: "offline",
            prompt: "consent",
            include_granted_scopes: "true",
            state,
            ...(loginHint ? { login_hint: loginHint } : {}),
        }).toString();
        await openInSystemBrowser(authUrl.toString());

        const returned = new URL(await redirected);
        // The listener is on an unprotected local port: only accept the
        // redirect for the sign-in this call started.
        if (returned.searchParams.get("state") !== state) {
            throw new Error("Google sign-in returned an unexpected response. Try again.");
        }
        const error = returned.searchParams.get("error");
        if (error) {
            throw new Error(error === "access_denied" ? "Google sign-in was cancelled." : `Google sign-in failed (${error}).`);
        }
        const code = returned.searchParams.get("code");
        if (!code) throw new Error("Google sign-in didn't return a code. Try again.");
        return { code, redirectUri };
    } finally {
        if (timer) clearTimeout(timer);
        unlisten?.();
        // Already stopped after a redirect; this covers a timeout or error.
        cancel(port).catch(() => undefined);
    }
};

import { Dropbox, DropboxAuth, AuthResponse, TokenResponse } from 'dropbox';
import { useEffect, useState, useCallback } from 'react';
import { showSuccess, showError } from '@/utils/toast';

const CLIENT_ID = import.meta.env.VITE_DROPBOX_CLIENT_ID;
const REDIRECT_URI = window.location.origin + "/auth/dropbox"; // Assuming this is the redirect URI

const dbxAuth = new DropboxAuth({
  clientId: CLIENT_ID,
});

export const useDropbox = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("dropbox_access_token");
    const email = localStorage.getItem("dropbox_user_email");
    const synced = localStorage.getItem("dropbox_last_synced");

    if (token) {
      setIsConnected(true);
      setUserEmail(email);
      setLastSynced(synced);
    }
  }, []);

  const login = useCallback(() => {
    if (!CLIENT_ID) {
      showError("Dropbox Client ID is not configured.");
      return;
    }
    const authUrl = dbxAuth.getAuthenticationUrl(REDIRECT_URI, undefined, 'code', 'offline', undefined, undefined, true);
    window.location.href = authUrl.toString();
  }, []);

  const handleAuthCallback = useCallback(async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");

    if (code) {
      try {
        const response: AuthResponse<TokenResponse> = await dbxAuth.getAccessTokenFromCode(REDIRECT_URI, code);
        const accessToken = response.result.access_token;

        localStorage.setItem("dropbox_access_token", accessToken);
        setIsConnected(true);

        // Fetch user info
        const dbx = new Dropbox({ accessToken });
        const accountInfo = await dbx.usersGetCurrentAccount();
        const email = accountInfo.result.email;
        localStorage.setItem("dropbox_user_email", email);
        setUserEmail(email);

        showSuccess("Connected to Dropbox!");
        window.history.replaceState({}, document.title, window.location.pathname); // Clean up URL
      } catch (error) {
        console.error("[useDropbox] Error during Dropbox authentication:", error);
        showError("Failed to connect to Dropbox.");
      }
    }
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem("dropbox_access_token");
    localStorage.removeItem("dropbox_user_email");
    localStorage.removeItem("dropbox_last_synced");
    setIsConnected(false);
    setUserEmail(null);
    setLastSynced(null);
    showSuccess("Disconnected from Dropbox.");
  }, []);

  const sync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const accessToken = localStorage.getItem("dropbox_access_token");
      if (!accessToken) {
        showError("Not connected to Dropbox.");
        return;
      }

      const dbx = new Dropbox({ accessToken });
      // Placeholder for actual sync logic
      console.log("[useDropbox] Simulating Dropbox sync...");
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate API call

      const now = new Date().toLocaleString();
      localStorage.setItem("dropbox_last_synced", now);
      setLastSynced(now);
      showSuccess("Notes synced with Dropbox!");
    } catch (error) {
      console.error("[useDropbox] Error during Dropbox sync:", error);
      showError("Failed to sync with Dropbox.");
    } finally {
      setIsSyncing(false);
    }
  }, []);

  return {
    isConnected,
    userEmail,
    lastSynced,
    isSyncing,
    login,
    handleAuthCallback,
    disconnect,
    sync,
  };
};
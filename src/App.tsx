// Copyright (c) 2026. Licensed under AGPLv3.
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Analytics, type BeforeSend } from "@vercel/analytics/react";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

import LockScreen from "./components/LockScreen";
import { Button } from "@/components/ui/button";
import React, { useState, useEffect, useRef } from "react";
import { checkDatabaseStatus, initializeDatabase, clearAllData, setSecureWindow, verifyEncryptionPin } from "./lib/note-storage";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { supabase } from "./integrations/supabase/client";
import FeedbackDialog from "./components/FeedbackDialog";
import { useSession } from "./context/session-provider";
import { ensureWidgetDeepLinkCapture } from "./hooks/use-widget-deep-link";
import {
  APP_LOCK_CHANGED_EVENT,
  getSessionPin,
  isAppLockEnabled,
  isEncryptionEnabled,
  migrateLegacyPins,
  setAppLockPin,
  setEncryptionEnabled,
  setSessionPin,
} from "./lib/pin";
import { upgradeLegacyNativeKey } from "./lib/encryption-pin";
import { syncImageEncryption } from "./lib/image-storage";
import { shouldRelock } from "./lib/app-relock";

const queryClient = new QueryClient();

// Analytics sends the full page address, and the query string can hold a label
// name (`/?tag=<label>`) or an OAuth `code`. Send the path only (C3-29).
const stripQueryForAnalytics: BeforeSend = (event) => {
  const url = new URL(event.url);
  url.search = "";
  url.hash = "";
  return { ...event, url: url.toString() };
};

const App = () => {
  const [appState, setAppState] = useState<'loading' | 'setup' | 'locked' | 'ready'>('loading');
  // Locked again after a trip to the background (C3-27), as opposed to at launch.
  // The database is still open then, so unlocking only has to check the PIN.
  const [relocked, setRelocked] = useState(false);
  const appStateRef = useRef(appState);
  useEffect(() => { appStateRef.current = appState; }, [appState]);
  const [shouldShowFeedback, setShouldShowFeedback] = useState(false);
  const { session } = useSession();

  // We need to know if we are on web or native to decide flow
  const isNative = Capacitor.isNativePlatform();

  // Capture widget deep links even while the lock screen is visible.
  useEffect(() => {
    ensureWidgetDeepLinkCapture();
  }, []);

  // App Lock also applies when coming back to a running app (C3-27): Android keeps
  // the process alive for days, so locking only at launch let anyone with the
  // phone open the notes from recent apps. Same lock screen as a launch, and Index
  // unmounts behind it, so widget taps and sync conflicts wait until it's unlocked.
  // NoteEditor saves any pending edit as the app goes to the background.
  useEffect(() => {
    if (!isNative) return;
    let backgroundedAt: number | null = null;
    const listenerPromise = CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) {
        backgroundedAt = Date.now();
        return;
      }
      const since = backgroundedAt;
      backgroundedAt = null;
      if (since === null || appStateRef.current !== 'ready' || !isAppLockEnabled()) return;
      if (shouldRelock(since, Date.now())) {
        setRelocked(true);
        setAppState('locked');
      }
    });
    return () => {
      listenerPromise.then((listener) => listener.remove());
    };
  }, [isNative]);

  // Keep Android's FLAG_SECURE (blank recent-apps card) in step with App Lock.
  useEffect(() => {
    const apply = () => { void setSecureWindow(isAppLockEnabled()); };
    apply();
    window.addEventListener(APP_LOCK_CHANGED_EVENT, apply);
    return () => window.removeEventListener(APP_LOCK_CHANGED_EVENT, apply);
  }, []);

  // Native key verification now happens on the first real read, not in checkStatus --
  // checkStatus reports whether an auto-unlock key is PRESENT, not whether it has been
  // proven. If that first read fails (wrong key, corrupt DB), Index.tsx fires this and
  // we fall back to the lock screen, which is where a failed verification always led.
  useEffect(() => {
    const handleUnverified = () => {
      setRelocked(false);
      setAppState('locked');
    };
    window.addEventListener("open-keep-db-unverified", handleUnverified);
    return () => window.removeEventListener("open-keep-db-unverified", handleUnverified);
  }, []);

  // Once the key is loaded, bring stored images in line with the encryption flag.
  // A no-op unless the flag changed or older plain images predate C1-16.
  useEffect(() => {
    if (appState !== 'ready') return;
    syncImageEncryption().catch((e) => console.error("Image encryption sweep failed", e));
  }, [appState]);

  useEffect(() => {
    const checkEntitlements = async () => {
      if (!session?.user) return;
      try {
        const { data: entitlementData } = await supabase
          .from('user_entitlements')
          .select('times_logged_in')
          .eq('user_id', session.user.id)
          .maybeSingle();

        const currentCount = entitlementData?.times_logged_in || 0;
        const newCount = currentCount + 1;

        const { error: upsertError } = await supabase
          .from('user_entitlements')
          .upsert({
            user_id: session.user.id,
            times_logged_in: newCount,
            last_login: new Date().toISOString()
          }, { onConflict: 'user_id' });

        if (upsertError) {
          console.error("Supabase upsert error:", JSON.stringify(upsertError, null, 2));
        }

        const { data: statusData } = await supabase
          .from('user_status')
          .select('ready_to_ask_for_feedback')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (statusData?.ready_to_ask_for_feedback) {
          setShouldShowFeedback(true);
        }
      } catch (err) {
        console.error("Failed to update login count", err);
      }
    };

    checkEntitlements();
  }, [session?.user?.id]);

  useEffect(() => {
    const init = async () => {
      try {
        // Converts the cleartext PIN keys from <= 5.0.5 before anything reads PIN state.
        const { legacyEncryptionPin } = await migrateLegacyPins();
        const encryptionOn = isEncryptionEnabled();
        const isLockEnabled = isAppLockEnabled();

        if (isNative) {
          const status = await checkDatabaseStatus();

          if (!status.isConfigured) {
            // Automatically initialize with empty PIN for transparent encryption
            await initializeDatabase("");
            setAppState('ready');
            return;
          }

          if (legacyEncryptionPin && !status.isLocked) {
            try {
              await upgradeLegacyNativeKey(legacyEncryptionPin);
            } catch (e) {
              // Not fatal: the next PIN unlock through initialize() upgrades it too.
              console.error("Legacy key upgrade failed", e);
            }
          }

          // Force locked if either native says so, or app-lock toggle is enabled.
          // An encrypted native DB may still auto-unlock: its key is held in the
          // Keystore/Keychain, so App Lock alone decides whether to ask.
          if (status.isLocked || isLockEnabled) {
            setAppState('locked');
          } else {
            setAppState('ready');
          }
        } else {
          // Web flow. The browser has nowhere safe to keep the key, so an
          // encrypted web vault always needs its PIN at launch. The one exception
          // is the launch that migrates a stored PIN, which already has it.
          if (encryptionOn) {
            const pin = getSessionPin();
            let unlocked = false;
            if (!isLockEnabled && pin) {
              unlocked = await initializeDatabase(pin).then(() => true, () => false);
            }
            if (unlocked) {
              setAppState('ready');
            } else {
              setAppState('locked');
            }
          } else {
            // Unencrypted web flow
            await initializeDatabase("");
            if (isLockEnabled) {
              setAppState('locked');
            } else {
              setAppState('ready');
            }
          }
        }
      } catch (e) {
        console.error("Failed to check DB status", e);
        setAppState('setup');
      }
    };

    init();
  }, [isNative]);



  // Verification by decryption: initializeDatabase throws if the PIN doesn't
  // unwrap the key (web) or open the DB (native).
  const handleUnlock = async (pin?: string) => {
    if (!pin) return false;
    try {
      await initializeDatabase(pin);
      setSessionPin(pin);
      setAppState('ready');
      return true;
    } catch (e) {
      console.error("Unlock failed", e);
    }
    // An enable/disable interrupted at the wrong moment leaves the flag on over a
    // key wrapped under the empty PIN (see encryption-pin.ts). If the key opens
    // with no PIN, it wasn't protected anyway: repair the flag and let them in,
    // keeping App Lock on with the PIN they just typed.
    try {
      await initializeDatabase("");
      setEncryptionEnabled(false);
      if (isAppLockEnabled()) await setAppLockPin(pin);
      setAppState('ready');
      return true;
    } catch {
      return false;
    }
  };

  // Unlock after a resume re-lock. Nothing is re-initialised: the database never
  // closed. LockScreen has already checked an App Lock PIN or biometrics before
  // calling this; an encryption PIN is checked here by unwrapping the key with it.
  // Deliberately not handleUnlock: native initialize() resets the open database,
  // and closes it on a wrong PIN, which would pull it out from under the widgets.
  const handleRelockUnlock = async (pin?: string): Promise<boolean> => {
    if (isEncryptionEnabled()) {
      if (!pin || !(await verifyEncryptionPin(pin))) return false;
      setSessionPin(pin);
    }
    setRelocked(false);
    setAppState('ready');
    return true;
  };

  const handleReset = () => {
    setRelocked(false);
    setAppState('setup');
  };

  const handleHardReset = async () => {
    if (window.confirm("Are you sure you want to reset all app data? This will wipe your local database and settings, but any notes synced to the cloud will remain there.")) {
      try {
        await clearAllData();
        localStorage.clear();
        window.location.reload();
      } catch (e) {
        console.error("Failed to clear data", e);
      }
    }
  };

  const handleSetupComplete = () => {
    setAppState('ready');
  };

  const handleFeedbackSubmit = async (feedback: "happy" | "sad", comments: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const { data: entitlementData } = await supabase
      .from('user_entitlements')
      .select('times_logged_in')
      .eq('user_id', session.user.id)
      .maybeSingle();

    const currentCount = entitlementData?.times_logged_in || 0;

    await supabase.from('user_entitlements').upsert({
      user_id: session.user.id,
      feedback: feedback,
      feedback_comments: comments,
      feedback_date: new Date().toISOString().split('T')[0],
      times_logged_in_when_feedback_requested: currentCount
    }, { onConflict: 'user_id' });
  };

  const handleFeedbackClose = async (skipped: boolean) => {
    setShouldShowFeedback(false);
    if (!skipped) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const { data: entitlementData } = await supabase
      .from('user_entitlements')
      .select('times_logged_in')
      .eq('user_id', session.user.id)
      .maybeSingle();

    const currentCount = entitlementData?.times_logged_in || 0;

    await supabase.from('user_entitlements').upsert({
      user_id: session.user.id,
      feedback_date: new Date().toISOString().split('T')[0],
      times_logged_in_when_feedback_requested: currentCount
    }, { onConflict: 'user_id' });
  };

  if (appState === 'loading') {
    return <div className="min-h-screen bg-background flex items-center justify-center text-text-primary">Loading...</div>;
  }

  // The 'setup' state is no longer used for initial load, as we auto-initialize transparently.
  // We keep it as a fallback error state if DB initialization fails catastrophically.
  if (appState === 'setup') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
        <h2 className="text-xl font-bold text-destructive mb-2">Database Error</h2>
        <p className="text-muted-foreground mb-4">
          The app failed to initialize its local database.<br/><br/>
          Don't worry, your notes are likely still safely stored on your device.
        </p>
        <div className="flex gap-4 mt-4">
          <Button onClick={() => window.location.reload()}>Retry</Button>
          <Button variant="destructive" onClick={handleHardReset}>Reset app data</Button>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      {(appState === 'locked') && (
        <LockScreen
          onUnlock={async (pin) => {
            if (relocked) return handleRelockUnlock(pin);
            if (isEncryptionEnabled()) {
              return handleUnlock(pin);
            } else {
              // Encryption disabled (transparent/empty PIN database):
              // Ensure the DB is initialized before unlocking the UI
              try {
                await initializeDatabase("");
                setAppState('ready');
                return true;
              } catch (e) {
                console.error("Transparent unlock failed", e);
                setAppState('setup');   // the Database Error screen, not a frozen spinner
                return false;
              }
            }
          }}
          isEncryptionEnabled={isEncryptionEnabled()}
          onReset={handleReset}
        />
      )}

      {/* Mount Index only when unlocked so widget deep links aren't consumed behind the lock screen. */}
      {appState === 'ready' && (
        <TooltipProvider>
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      )}
      <FeedbackDialog
        isOpen={shouldShowFeedback}
        onClose={handleFeedbackClose}
        onSubmit={handleFeedbackSubmit}
      />
      {/* Vercel analytics is web-only; on native its script 404s on every launch. */}
      {!isNative && <Analytics beforeSend={stripQueryForAnalytics} />}
    </QueryClientProvider>
  );
};

export default App;

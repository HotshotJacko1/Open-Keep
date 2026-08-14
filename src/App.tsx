// Copyright (c) 2026. Licensed under AGPLv3.
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

import LockScreen from "./components/LockScreen";
import React, { useState, useEffect, useRef } from "react";
import { checkDatabaseStatus, initializeDatabase, lockDatabase } from "./lib/note-storage";
import { Capacitor } from "@capacitor/core";
import { supabase } from "./integrations/supabase/client";
import FeedbackDialog from "./components/FeedbackDialog";
import { useSession } from "./context/session-provider";

const queryClient = new QueryClient();

const App = () => {
  const [appState, setAppState] = useState<'loading' | 'setup' | 'locked' | 'ready'>('loading');
  const [shouldShowFeedback, setShouldShowFeedback] = useState(false);
  const { session } = useSession();

  // We need to know if we are on web or native to decide flow
  const isNative = Capacitor.isNativePlatform();

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
        // First check if a passcode is set in localStorage
        const hasPasscode = !!localStorage.getItem("app-passcode");
        const isLockEnabled = localStorage.getItem("app-lock-enabled") === "true";

        if (isNative) {
          const status = await checkDatabaseStatus();

          if (!status.isConfigured) {
            // Automatically initialize with empty PIN for transparent encryption
            await initializeDatabase("");
            setAppState('ready');
            return;
          }

          // Force locked if either native says so, or app-lock toggle is enabled
          if (status.isLocked || isLockEnabled) {
            setAppState('locked');
          } else {
            setAppState('ready');
          }
        } else {
          // Web flow
          if (hasPasscode) {
            if (isLockEnabled) {
              setAppState('locked');
            } else {
              const pin = localStorage.getItem("app-passcode");
              if (pin) {
                await initializeDatabase(pin);
              }
              setAppState('ready');
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



  const handleUnlock = async (pin?: string) => {
    if (!pin) return false;
    try {
      await initializeDatabase(pin);
      setAppState('ready');
      return true;
    } catch (e) {
      console.error("Unlock failed", e);
      return false;
    }
  };

  const handleReset = () => {
    setAppState('setup');
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
        <p className="text-muted-foreground mb-4">The app failed to initialize its local database.</p>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      {(appState === 'locked') && (
        <LockScreen
          onUnlock={async (pin) => {
            const hasPasscode = !!localStorage.getItem("app-passcode");
            if (hasPasscode) {
              if (isNative) {
                const success = await handleUnlock(pin);
                if (success) setAppState('ready');
                return success;
              } else {
                // Web flow with encryption: initialize database with pin
                try {
                  await initializeDatabase(pin);
                  setAppState('ready');
                  return true;
                } catch (e) {
                  console.error("Unlock failed on web", e);
                  return false;
                }
              }
            } else {
              // Encryption disabled (transparent/empty PIN database):
              // Just unlock the UI
              setAppState('ready');
              return true;
            }
          }}
          isNativeEncryption={isNative && !!localStorage.getItem("app-passcode")}
          onReset={handleReset}
        />
      )}

      {/* Only render app content if ready (or if locked is an overlay, but we want to block access) */}
      <div style={{ display: appState === 'ready' ? 'block' : 'none' }}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </div>
      <FeedbackDialog
        isOpen={shouldShowFeedback}
        onClose={handleFeedbackClose}
        onSubmit={handleFeedbackSubmit}
      />
      <Analytics />
    </QueryClientProvider>
  );
};

export default App;

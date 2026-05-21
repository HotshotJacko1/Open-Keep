// Copyright (c) 2026. Licensed under AGPLv3.
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

import LockScreen from "./components/LockScreen";
import EncryptionSetupScreen from "./components/EncryptionSetupScreen";
import React, { useState, useEffect, useRef } from "react";
import { checkDatabaseStatus, initializeDatabase, lockDatabase } from "./lib/note-storage";
import { Capacitor } from "@capacitor/core";
import { supabase } from "./integrations/supabase/client";
import FeedbackDialog from "./components/FeedbackDialog";

const queryClient = new QueryClient();

const App = () => {
  const [appState, setAppState] = useState<'loading' | 'setup' | 'locked' | 'ready'>('loading');
  const [shouldShowFeedback, setShouldShowFeedback] = useState(false);

  // We need to know if we are on web or native to decide flow
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    const init = async () => {
      try {
        // Initialize Supabase Anonymous Auth
        const { data: { session } } = await supabase.auth.getSession();
        let currentUser = session?.user;
        if (!session) {
          const { data: authData, error } = await supabase.auth.signInAnonymously();
          if (error) console.error("Anonymous sign in failed", error);
          currentUser = authData?.user;
        }

        if (currentUser) {
          try {
            const { data: entitlementData } = await supabase
              .from('user_entitlements')
              .select('created_at, feedback_date, times_logged_in, times_logged_in_when_feedback_requested')
              .eq('user_id', currentUser.id)
              .maybeSingle();

            const currentCount = entitlementData?.times_logged_in || 0;
            const newCount = currentCount + 1;

            const { error: upsertError } = await supabase
              .from('user_entitlements')
              .upsert({
                user_id: currentUser.id,
                times_logged_in: newCount,
                last_login: new Date().toISOString()
              }, { onConflict: 'user_id' });

            if (upsertError) {
              console.error("Supabase upsert error:", JSON.stringify(upsertError, null, 2));
            }

            const oneMonthAgo = new Date();
            oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

            const twoMonthsAgo = new Date();
            twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

            const createdAtDate = entitlementData?.created_at ? new Date(entitlementData.created_at) : new Date();
            const feedbackDate = entitlementData?.feedback_date ? new Date(entitlementData.feedback_date) : null;
            const timesWhenRequested = entitlementData?.times_logged_in_when_feedback_requested || 0;

            const isOldEnough = createdAtDate < oneMonthAgo;
            const isFeedbackOldEnough = !feedbackDate || feedbackDate < twoMonthsAgo;
            const hasEnoughLogins = newCount > (timesWhenRequested + 9);

            if (isOldEnough && isFeedbackOldEnough && hasEnoughLogins) {
              setShouldShowFeedback(true);
            }
          } catch (err) {
            console.error("Failed to update login count", err);
          }
        }
        // First check if a passcode is set in localStorage
        const hasPasscode = !!localStorage.getItem("app-passcode");
        const isLockEnabled = localStorage.getItem("app-lock-enabled") === "true";

        if (isNative) {
          const status = await checkDatabaseStatus();

          if (!status.isConfigured) {
            setAppState('setup');
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
          if (isLockEnabled && hasPasscode) {
            setAppState('locked');
          } else {
            setAppState('ready');
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
    setShouldShowFeedback(false);
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

  if (appState === 'setup') {
    return (
      <React.Fragment>
        <Toaster />
        <EncryptionSetupScreen onSetupComplete={handleSetupComplete} />
      </React.Fragment>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      {(appState === 'locked') && (
        <LockScreen
          onUnlock={async (pin) => {
            if (isNative) {
              const success = await handleUnlock(pin);
              if (success) setAppState('ready');
              return success;
            } else {
              setAppState('ready');
              return true;
            }
          }}
          isNativeEncryption={isNative}
          onReset={handleReset}
        />
      )}

      {/* Only render app content if ready (or if locked is an overlay, but we want to block access) */}
      <div style={{ display: appState === 'ready' ? 'block' : 'none' }}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
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
    </QueryClientProvider>
  );
};

export default App;

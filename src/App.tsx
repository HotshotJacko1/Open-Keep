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

const queryClient = new QueryClient();

const App = () => {
  const [appState, setAppState] = useState<'loading' | 'setup' | 'locked' | 'ready'>('loading');

  // We need to know if we are on web or native to decide flow
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    const init = async () => {
      try {
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

  if (appState === 'loading') {
    return <div className="min-h-screen bg-background flex items-center justify-center">Loading...</div>;
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
    </QueryClientProvider>
  );
};

export default App;

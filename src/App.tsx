import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { App as CapacitorApp } from "@capacitor/app";
import LockScreen from "./components/LockScreen";
import EncryptionSetupScreen from "./components/EncryptionSetupScreen";
import React, { useState, useEffect, useRef } from "react";
import { checkDatabaseStatus, initializeDatabase } from "./lib/note-storage";
import { Capacitor } from "@capacitor/core";

const queryClient = new QueryClient();

const App = () => {
  const [appState, setAppState] = useState<'loading' | 'setup' | 'locked' | 'ready'>('loading');

  // We need to know if we are on web or native to decide flow
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    // If web, just go to ready for now (or handle legacy auth)
    if (!isNative) {
      setAppState('ready');
      return;
    }

    const init = async () => {
      try {
        const status = await checkDatabaseStatus();
        if (status.isConfigured) {
          setAppState('locked');
        } else {
          setAppState('setup');
        }
      } catch (e) {
        console.error("Failed to check DB status", e);
        // Fallback to setup if check fails? Or error screen?
        setAppState('setup');
      }
    };

    init();
  }, [isNative]);

  useEffect(() => {
    // Handle App State
    const listener = CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) {
        // App went to background
        // In native encryption mode, we might want to lock again
        // But simply setting 'locked' might not be enough if we need to close the DB connection
        // For now, let's just show lock screen which will require re-enter PIN to 're-initialize' (which is effectively a no-op if open, or re-open if closed)
        if (isNative && appState === 'ready') {
          setAppState('locked');
        }
      }
    });

    return () => {
      listener.then(handle => handle.remove());
    };
  }, [isNative, appState]);

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
              // LockScreen component expects us to call its callback or state?
              // Actually LockScreen prop is `onUnlock: () => void`. We need to change it to accept pin or async.
              // For now, let's assume LockScreen simply calls this and we handle state.
              // Wait, existing LockScreen might not pass PIN. Need to check LockScreen.
            } else {
              setAppState('ready');
            }
          }}
          isNativeEncryption={isNative}
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

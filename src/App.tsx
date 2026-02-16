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
import { checkDatabaseStatus, initializeDatabase, lockDatabase } from "./lib/note-storage";
import { Capacitor } from "@capacitor/core";

const queryClient = new QueryClient();

const App = () => {
  const [appState, setAppState] = useState<'loading' | 'setup' | 'locked' | 'ready'>('loading');

  // We need to know if we are on web or native to decide flow
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!isNative) {
      setAppState('ready');
      return;
    }

    const checkAutoLock = async (): Promise<boolean> => {
      const lastActiveStr = localStorage.getItem('app-last-active');
      const timeoutStr = localStorage.getItem('auto-lock-timeout') || 'never';

      if (timeoutStr === 'never') return false;
      if (timeoutStr === 'immediate') return true;

      if (!lastActiveStr) return false;

      const lastActive = parseInt(lastActiveStr, 10);
      const timeoutMin = parseInt(timeoutStr, 10);

      if (Date.now() - lastActive > timeoutMin * 60 * 1000) {
        return true;
      }
      return false;
    };

    const init = async () => {
      try {
        const status = await checkDatabaseStatus();
        if (!status.isConfigured) {
          setAppState('setup');
          return;
        }

        // isLocked might be true/false/undefined. If undefined, assume unlocked? No, assume locked for safety?
        // Actually, if we just launched, native checkDatabaseStatus returns if KeyManager has key.
        // If it has key, it returns unlocked/ready (isLocked=false).

        if (status.isLocked) {
          setAppState('locked');
        } else {
          const shouldLock = await checkAutoLock();
          if (shouldLock) {
            await lockDatabase();
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

  useEffect(() => {
    const listener = CapacitorApp.addListener("appStateChange", async ({ isActive }) => {
      const timeoutStr = localStorage.getItem('auto-lock-timeout') || 'never';

      if (!isActive) {
        // Background
        localStorage.setItem('app-last-active', Date.now().toString());
        if (isNative && timeoutStr === 'immediate') {
          await lockDatabase();
          // We don't necessarily update state here if UI is hidden, 
          // but when we come back, we might need to show lock screen.
          setAppState('locked');
        }
      } else {
        // Foreground
        if (isNative && appState === 'ready') {
          if (timeoutStr === 'never') return;

          // If immediate, we should be locked already from background handler.
          // If we are still 'ready', maybe check again?
          if (timeoutStr === 'immediate') {
            // Force lock check
            const status = await checkDatabaseStatus();
            if (status.isLocked) setAppState('locked');
            return;
          }

          const lastActiveStr = localStorage.getItem('app-last-active');
          if (lastActiveStr) {
            const lastActive = parseInt(lastActiveStr, 10);
            const timeoutMin = parseInt(timeoutStr, 10);
            if (Date.now() - lastActive > timeoutMin * 60 * 1000) {
              await lockDatabase();
              setAppState('locked');
            }
          }
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

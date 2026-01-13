import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { App as CapacitorApp } from "@capacitor/app";
import LockScreen from "./components/LockScreen";
import React, { useState, useEffect, useRef } from "react";

const queryClient = new QueryClient();

const App = () => {
  const [isLocked, setIsLocked] = useState(false);
  // Ref to track if we should lock on resume. 
  // We generally want to lock if the app was in background for > X seconds, or always.
  // For simplicity, let's lock immediately if backgrounded.

  useEffect(() => {
    // Check initial passcode
    const hasPasscode = localStorage.getItem("app-passcode");
    if (hasPasscode) {
      setIsLocked(true);
    }

    // Handle App State
    const listener = CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) {
        // App went to background
        // Check again if passcode is set, because user might have removed it.
        if (localStorage.getItem("app-passcode")) {
          setIsLocked(true);
        }
      }
    });

    return () => {
      listener.then(handle => handle.remove());
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {isLocked && <LockScreen onUnlock={() => setIsLocked(false)} />}
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;

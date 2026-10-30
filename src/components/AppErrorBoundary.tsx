// Copyright (c) 2026. Licensed under AGPLv3.
import React from "react";
import { Button } from "@/components/ui/button";

interface AppErrorBoundaryProps {
  children: React.ReactNode;
  /** Reports the error; a boundary-caught error never reaches window.onerror. */
  onError: (error: unknown) => void;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

/**
 * The last line of defence for a render error. Without it React unmounts the
 * whole tree and the user gets a blank screen with no way back but closing the
 * app (C4-17, and the crash class behind C4-14). Notes are saved as they are
 * typed, so reloading loses nothing that was already on screen.
 */
export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 bg-background text-text-primary text-center">
        <h1 className="text-xl font-medium">Something went wrong</h1>
        <p className="max-w-sm text-muted-foreground">
          Open Keep hit an unexpected error. Your notes are safe. Reload to carry on.
        </p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}

// Copyright (c) 2026. Licensed under AGPLv3.
import { useTheme } from "@/context/theme-provider";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group !z-[100]"
      // M3 snackbar placement: bottom-centre, never covering the FAB. On phones
      // the toast spans the width, so it sits just above the FAB instead
      // (FAB: 2rem + safe area from the bottom, 56px tall; +8px gap).
      position="bottom-center"
      mobileOffset={{ bottom: "calc(2rem + 64px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))" }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-inverse-surface group-[.toaster]:text-inverse-foreground group-[.toaster]:border-transparent group-[.toaster]:rounded group-[.toaster]:shadow-elevation-3 text-body-md",
          description: "group-[.toast]:text-inverse-foreground/80",
          actionButton:
            "group-[.toast]:bg-transparent group-[.toast]:text-inverse-primary group-[.toast]:hover:bg-inverse-primary/10 active:group-[.toast]:bg-inverse-primary/20 text-label-lg px-3 py-1.5 rounded-full cursor-pointer transition-colors shrink-0",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

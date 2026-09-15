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
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background text-black dark:text-white group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-transparent group-[.toast]:text-yellow-600 dark:group-[.toast]:text-yellow-400 group-[.toast]:hover:bg-yellow-500/10 active:group-[.toast]:bg-yellow-500/20 font-semibold text-sm px-3 py-1.5 rounded cursor-pointer transition-colors shrink-0",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

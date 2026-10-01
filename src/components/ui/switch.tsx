// Copyright (c) 2026. Licensed under AGPLv3.
import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

// Material 3 switch: 52x32 track; off = outlined track with a 16px handle, on =
// filled track with a 24px handle, pressed = 28px. The app's `--primary` is a
// neutral grey, so "on" uses the amber of the sidebar's selected item instead —
// every colour pair here is at least 3:1 (WCAG 1.4.11) in both themes.
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "group peer inline-flex h-8 w-[52px] shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors duration-200 ease-[cubic-bezier(0.2,0,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-[0.38]",
      "data-[state=unchecked]:border-outline data-[state=unchecked]:bg-switch-track",
      "data-[state=checked]:border-transparent data-[state=checked]:bg-brand",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none relative block rounded-full shadow-sm transition-[width,height,transform,background-color] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
        // Handle: 16px off, 24px on, 28px while pressed; centres stay at 16px / 36px of the track.
        "data-[state=unchecked]:h-4 data-[state=unchecked]:w-4 data-[state=unchecked]:translate-x-[6px] group-active:data-[state=unchecked]:h-7 group-active:data-[state=unchecked]:w-7 group-active:data-[state=unchecked]:translate-x-0",
        "data-[state=checked]:h-6 data-[state=checked]:w-6 data-[state=checked]:translate-x-[22px] group-active:data-[state=checked]:h-7 group-active:data-[state=checked]:w-7 group-active:data-[state=checked]:translate-x-5",
        "data-[state=unchecked]:bg-outline data-[state=checked]:bg-brand-foreground",
        // 40px state layer around the handle: 8% on hover, 10% while pressed.
        "before:absolute before:left-1/2 before:top-1/2 before:h-10 before:w-10 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-current before:opacity-0 before:transition-opacity group-hover:before:opacity-[0.08] group-active:before:opacity-10",
        "data-[state=unchecked]:text-foreground data-[state=checked]:text-brand",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };

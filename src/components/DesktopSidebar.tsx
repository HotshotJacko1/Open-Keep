// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import SidebarNav from "@/components/SidebarNav";
import { cn } from "@/lib/utils";

/** M3 navigation rail width. Nav items are laid out so their icons sit centred in it. */
export const RAIL_WIDTH = 72;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 256;
const STORAGE_KEY = "open-keep-sidebar-width";
// Where react-resizable-panels (the previous implementation) saved its layout,
// as percentages of the window. Read once so an existing width carries over.
const LEGACY_STORAGE_KEY = "react-resizable-panels:openkeep-sidebar";

const clamp = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));

function loadWidth(): number {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (saved) return clamp(saved);
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const layout = Object.values(JSON.parse(legacy) as Record<string, { layout?: number[] }>)[0]?.layout;
      if (layout?.[0]) return clamp((layout[0] / 100) * window.innerWidth);
    }
  } catch {
    // Storage blocked or malformed: fall through to the default.
  }
  return DEFAULT_WIDTH;
}

interface DesktopSidebarProps {
  collapsed: boolean;
  uniqueTags: string[];
  onEditLabels: () => void;
}

/**
 * Desktop navigation: an M3 navigation drawer that animates down to a
 * navigation rail when collapsed (and back), instead of swapping layouts.
 *
 * The nav's items never change layout -- only the panel's width animates and
 * `overflow-hidden` clips it -- so icons stay put while labels fade. When
 * collapsed, hovering the rail widens it as a floating panel over the notes,
 * like Google Keep on the web. When expanded, the right edge can be dragged
 * (or moved with the arrow keys) to resize.
 */
const DesktopSidebar: React.FC<DesktopSidebarProps> = ({ collapsed, uniqueTags, onEditLabels }) => {
  const [width, setWidth] = useState(loadWidth);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
      // Ignore: the width just won't persist.
    }
  }, [width]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width };
    setDragging(true);
  }, [width]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setWidth(clamp(drag.current.startWidth + e.clientX - drag.current.startX));
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
    setDragging(false);
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowLeft") setWidth((w) => clamp(w - step));
    else if (e.key === "ArrowRight") setWidth((w) => clamp(w + step));
    else return;
    e.preventDefault();
  }, []);

  // No width animation while dragging, so the panel tracks the pointer.
  const motion = dragging ? "transition-none" : "transition-[width,box-shadow] duration-md3-medium2 ease-md3-standard";

  return (
    // Layout slot: how much room the notes give up. The panel inside can grow
    // past it (hover on the rail) without pushing the notes around.
    <div
      className={cn("relative z-20 flex-none h-full", motion)}
      style={{ width: collapsed ? RAIL_WIDTH : width, "--sidebar-width": `${width}px` } as React.CSSProperties}
    >
      <div
        className={cn(
          "group/sidebar absolute inset-y-0 left-0 z-30 flex flex-col overflow-hidden pt-4",
          "bg-sidebar dark:bg-sidebar text-sidebar-foreground border-r border-sidebar-border",
          motion,
          collapsed ? "w-[72px] hover:w-[var(--sidebar-width)] hover:shadow-2xl" : "w-[var(--sidebar-width)]"
        )}
      >
        <SidebarNav uniqueTags={uniqueTags} onEditLabels={onEditLabels} collapsed={collapsed} />
      </div>

      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          className="absolute inset-y-0 -right-1.5 z-40 flex w-3 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
            <GripVertical className="h-2.5 w-2.5" />
          </div>
        </div>
      )}
    </div>
  );
};

export default DesktopSidebar;

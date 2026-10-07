// Copyright (c) 2026. Licensed under AGPLv3.
import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Lightbulb, Tag, Archive, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SidebarNavProps {
  uniqueTags: string[];
  onClose?: () => void; // Optional for closing sheet on mobile
  onEditLabels?: () => void;
  /**
   * Shown as an M3 navigation rail (DesktopSidebar): labels fade out, and
   * back in while the rail is hovered open (`group/sidebar`).
   */
  collapsed?: boolean;
}

// Every item has the same fixed geometry whatever the sidebar's width: a 48px
// row whose icon sits 26px in (nav p-3 + item pl-3.5), i.e. centred in the
// 72px rail. So when the sidebar animates between drawer and rail nothing
// reflows -- the width just clips -- and the selected pill shrinks into a
// circle around the icon.
const itemClass =
  "h-12 w-full justify-start gap-0 rounded-full pl-3.5 pr-4 text-lg text-foreground select-none whitespace-nowrap overflow-hidden transition-colors [&_svg]:size-5";
const selectedClass =
  "bg-sidebar-foreground dark:bg-sidebar-foreground hover:bg-sidebar-foreground/90 dark:hover:bg-sidebar-foreground/90";

const SidebarNav: React.FC<SidebarNavProps> = ({ uniqueTags, onClose, onEditLabels, collapsed = false }) => {
  const [searchParams] = useSearchParams();
  const selectedTag = searchParams.get("tag");

  const handleNavigation = () => {
    if (onClose) {
      onClose();
    }
  };

  // Labels are single-line with an ellipsis (full text in the tooltip).
  const labelClass = cn(
    "ml-4 min-w-0 flex-1 truncate text-left transition-opacity duration-md3-short4",
    collapsed && "opacity-0 group-hover/sidebar:opacity-100"
  );

  const navItem = (to: string, icon: React.ReactNode, label: string, selected: boolean) => (
    <Button
      key={to}
      variant="ghost"
      className={cn(itemClass, selected && selectedClass)}
      asChild
      onClick={handleNavigation}
    >
      <Link to={to} draggable={false} title={collapsed ? label : undefined} aria-label={collapsed ? label : undefined}>
        {icon}
        <span className={labelClass}>{label}</span>
      </Link>
    </Button>
  );

  return (
    <nav
      className={cn(
        "flex h-full flex-col overflow-y-auto overflow-x-hidden p-3 [scrollbar-width:thin]",
        // The rail is too narrow for a scrollbar; it returns when hovered open.
        collapsed && "[scrollbar-width:none] group-hover/sidebar:[scrollbar-width:thin]"
      )}
    >
      {navItem("/", <Lightbulb />, "Notes", !selectedTag)}

      <div className="pt-4 flex flex-col gap-1">
        {uniqueTags.length === 0 && (
          <p className={cn("text-sm text-muted-foreground px-4 whitespace-nowrap overflow-hidden", collapsed && "opacity-0 group-hover/sidebar:opacity-100 transition-opacity")}>
            No labels yet.
          </p>
        )}
        {uniqueTags.map((tag) => (
          <Button
            key={tag}
            variant="ghost"
            className={cn(itemClass, selectedTag === tag && selectedClass)}
            asChild
            onClick={handleNavigation}
          >
            <Link to={`/?tag=${encodeURIComponent(tag)}`} draggable={false} title={tag} aria-label={collapsed ? tag : undefined}>
              <Tag />
              <span dir="auto" className={labelClass}>{tag}</span>
            </Link>
          </Button>
        ))}
        {onEditLabels && (
          <Button
            variant="ghost"
            className={cn(itemClass, "mt-1")}
            onClick={onEditLabels}
            title={collapsed ? "Edit labels" : undefined}
            aria-label={collapsed ? "Edit labels" : undefined}
          >
            <Pencil />
            <span className={labelClass}>Edit labels</span>
          </Button>
        )}
      </div>

      <div className="pt-4 mt-2 mb-2 flex flex-col gap-1">
        {navItem("/?tag=archive", <Archive />, "Archive", selectedTag === "archive")}
        {navItem("/?tag=bin", <Trash2 />, "Bin", selectedTag === "bin")}
      </div>
    </nav>
  );
};

export default SidebarNav;

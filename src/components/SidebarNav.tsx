import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Lightbulb, Tag, Archive, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SidebarNavProps {
  uniqueTags: string[];
  onClose?: () => void; // Optional for closing sheet on mobile
  onEditLabels?: () => void;
}

const SidebarNav: React.FC<SidebarNavProps> = ({ uniqueTags, onClose, onEditLabels }) => {
  const [searchParams] = useSearchParams();
  const selectedTag = searchParams.get("tag");

  const handleNavigation = () => {
    if (onClose) {
      onClose();
    }
  };

  return (
    <nav className="flex flex-col p-2 space-y-1">
      <Button
        variant="ghost"
        className={cn(
          "text-black justify-start px-4 py-2 rounded-full text-lg",
          !selectedTag && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/90"
        )}
        asChild
        onClick={handleNavigation}
      >
        <Link to="/">
          <Lightbulb className="mr-4 h-5 w-5" />
          Notes
        </Link>
      </Button>

      <div className="pt-4">
        {uniqueTags.length === 0 && (
          <p className="text-sm text-muted-foreground px-4">No labels yet.</p>
        )}
        {uniqueTags.map((tag) => (
          <Button
            key={tag}
            variant="ghost"
            className={cn(
              "justify-start px-4 py-2 rounded-full text-lg",
              selectedTag === tag && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/90"
            )}
            asChild
            onClick={handleNavigation}
          >
            <Link to={`/?tag=${tag}`}>
              <Tag className="mr-4 h-5 w-5" />
              {tag}
            </Link>
          </Button>
        ))}
        {onEditLabels && (
          <Button
            variant="ghost"
            className="justify-start px-4 py-2 rounded-full text-lg w-full mt-2 text-black dark:text-white"
            onClick={onEditLabels}
          >
            <Pencil className="mr-4 h-5 w-5" />
            Edit labels
          </Button>
        )}
      </div>

      <div className="pt-4 mt-2">
        <Button
          variant="ghost"
          className={cn(
            "text-black justify-start px-4 py-2 rounded-full text-lg w-full",
            selectedTag === "archive" && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/90"
          )}
          asChild
          onClick={handleNavigation}
        >
          <Link to="/?tag=archive">
            <Archive className="mr-4 h-5 w-5" />
            Archive
          </Link>
        </Button>
      </div>
    </nav>
  );
};

export default SidebarNav;
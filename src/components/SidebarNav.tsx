import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Lightbulb, Tag, Archive, Pencil, Trash2 } from "lucide-react";
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
          "text-black justify-start px-4 py-2 rounded-full text-lg whitespace-nowrap overflow-hidden transition-all",
          !selectedTag && "bg-sidebar-accent text-black dark:text-white  hover:bg-sidebar-accent/90"
        )}
        asChild
        onClick={handleNavigation}
      >
        <Link to="/">
          <Lightbulb className="mr-4 h-5 w-5 flex-shrink-0" />
          Notes
        </Link>
      </Button>

      <div className="pt-4">
        {uniqueTags.length === 0 && (
          <p className="text-sm text-muted-foreground px-4 whitespace-nowrap overflow-hidden">No labels yet.</p>
        )}
        {uniqueTags.map((tag) => (
          <Button
            key={tag}
            variant="ghost"
            className={cn(
              "justify-start px-4 py-2 rounded-full text-lg whitespace-nowrap overflow-hidden transition-all",
              selectedTag === tag && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/90"
            )}
            asChild
            onClick={handleNavigation}
          >
            <Link to={`/?tag=${tag}`}>
              <Tag className="mr-4 h-5 w-5 flex-shrink-0" />
              {tag}
            </Link>
          </Button>
        ))}
        {onEditLabels && (
          <Button
            variant="ghost"
            className="justify-start px-4 py-2 rounded-full text-lg w-full mt-2 text-black dark:text-white whitespace-nowrap overflow-hidden transition-all"
            onClick={onEditLabels}
          >
            <Pencil className="mr-4 h-5 w-5 flex-shrink-0" />
            Edit labels
          </Button>
        )}
      </div>

      <div className="pt-4 mt-2 mb-2">
        <Button
          variant="ghost"
          className={cn(
            "text-black dark:text-white justify-start px-4 py-2 rounded-full text-lg w-full whitespace-nowrap overflow-hidden transition-all",
            selectedTag === "archive" && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/90"
          )}
          asChild
          onClick={handleNavigation}
        >
          <Link to="/?tag=archive">
            <Archive className="mr-4 h-5 w-5 flex-shrink-0" />
            Archive
          </Link>
        </Button>
        <Button
          variant="ghost"
          className={cn(
            "text-black dark:text-white justify-start px-4 py-2 rounded-full text-lg w-full whitespace-nowrap overflow-hidden transition-all",
            selectedTag === "bin" && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/90"
          )}
          asChild
          onClick={handleNavigation}
        >
          <Link to="/?tag=bin">
            <Trash2 className="mr-4 h-5 w-5 flex-shrink-0" />
            Bin
          </Link>
        </Button>
      </div>
    </nav>
  );
};

export default SidebarNav;
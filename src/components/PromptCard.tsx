// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useId } from "react";
import { Button } from "@/components/ui/button";

interface PromptCardProps {
  title: string;
  children: React.ReactNode;
  secondaryLabel: string;
  onSecondary: () => void;
  primaryLabel: string;
  onPrimary: () => void;
}

/** Rounded card with a text and a tonal button, shown at the top of the notes list. */
const PromptCard: React.FC<PromptCardProps> = ({
  title,
  children,
  secondaryLabel,
  onSecondary,
  primaryLabel,
  onPrimary,
}) => {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="bg-surface-container-high text-text-primary rounded-dialog p-6 mb-4 sm:max-w-[560px] sm:mx-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <h2 id={titleId} className="text-2xl font-normal mb-3">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
      <div className="flex justify-end items-center gap-2 mt-5">
        <Button variant="text" className="rounded-full" onClick={onSecondary}>
          {secondaryLabel}
        </Button>
        <Button
          className="rounded-full bg-brand-container text-brand-container-foreground hover:bg-brand-container/90"
          onClick={onPrimary}
        >
          {primaryLabel}
        </Button>
      </div>
    </section>
  );
};

export default PromptCard;

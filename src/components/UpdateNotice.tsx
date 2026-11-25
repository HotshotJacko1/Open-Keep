// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import ChangelogDialog from "./ChangelogDialog";
import { markUpdateNoticeSeen, shouldShowUpdateNotice } from "@/lib/update-notice";

/** "App updated" card shown at the top of the notes list after an update. */
const UpdateNotice: React.FC = () => {
  const [isVisible, setIsVisible] = useState(() => shouldShowUpdateNotice(__APP_VERSION__));
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);

  const close = () => {
    markUpdateNoticeSeen(__APP_VERSION__);
    setIsVisible(false);
  };

  return (
    <>
      {isVisible && (
        <section
          aria-labelledby="update-notice-title"
          className="bg-surface-container-high text-text-primary rounded-dialog p-6 mb-4 sm:max-w-[560px] sm:mx-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="update-notice-title" className="text-2xl font-normal mb-3">
            App updated
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Open Keep was just updated to {__APP_VERSION__}. Would you like to see the release notes?
          </p>
          <div className="flex justify-end items-center gap-2 mt-5">
            <Button variant="text" className="rounded-full" onClick={close}>
              Dismiss
            </Button>
            <Button
              className="rounded-full bg-brand-container text-brand-container-foreground hover:bg-brand-container/90"
              onClick={() => {
                close();
                setIsChangelogOpen(true);
              }}
            >
              What's New
            </Button>
          </div>
        </section>
      )}
      <ChangelogDialog
        open={isChangelogOpen}
        onOpenChange={setIsChangelogOpen}
        showTrigger={false}
      />
    </>
  );
};

export default UpdateNotice;

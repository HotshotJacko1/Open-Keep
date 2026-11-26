// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useEffect, useState } from "react";
import ChangelogDialog from "./ChangelogDialog";
import FeedbackDialog from "./FeedbackDialog";
import PromptCard from "./PromptCard";
import { markUpdateNoticeSeen, shouldShowUpdateNotice } from "@/lib/update-notice";
import {
  AFTER_DONATE_DELAY_MS,
  FEEDBACK_PROMPT,
  KOFI_URL,
  SUPPORT_PROMPT,
  recordLaunch,
  snoozeLaunchPrompt,
} from "@/lib/launch-prompts";
import { isUsageReportingEnabled } from "@/lib/build-flavor";
import { submitFeedback } from "@/lib/usage-reporting";

type LaunchCardKind = "update" | "feedback" | "support" | null;

// Feedback skips the card and opens "Would you recommend Open Keep?" directly,
// once the notes list has had a moment to settle.
const FEEDBACK_DIALOG_DELAY_MS = 3000;

// Decided once per page load: the notes list remounts when the layout switches
// between mobile and desktop, and that mustn't count as another launch. Every
// prompt counts every launch, but at most one card shows, in this order.
let launchCard: LaunchCardKind | undefined;
const pickLaunchCard = (): LaunchCardKind => {
  if (launchCard === undefined) {
    const now = Date.now();
    let card: LaunchCardKind = shouldShowUpdateNotice(__APP_VERSION__) ? "update" : null;
    // Self-hosted builds have nowhere to send feedback.
    if (isUsageReportingEnabled && recordLaunch(FEEDBACK_PROMPT, now, card === null)) card = "feedback";
    if (recordLaunch(SUPPORT_PROMPT, now, card === null)) card = "support";
    launchCard = card;
  }
  return launchCard;
};

/**
 * At most one launch prompt per launch: the "App updated" card at the top of
 * the notes list after an update, otherwise now and then the feedback dialog
 * ("Would you recommend Open Keep?") or the "Enjoying Open Keep?" card.
 */
const LaunchCard: React.FC = () => {
  const [card, setCard] = useState<LaunchCardKind>(pickLaunchCard);
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);

  const hide = () => {
    launchCard = null;
    setCard(null);
  };

  // A remount within the delay (e.g. a layout switch) re-arms it; the launch is
  // only used up once the dialog actually opens.
  useEffect(() => {
    if (card !== "feedback") return;
    const timer = window.setTimeout(() => {
      launchCard = null;
      setCard(null);
      setIsFeedbackOpen(true);
    }, FEEDBACK_DIALOG_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [card]);

  const closeUpdate = () => {
    markUpdateNoticeSeen(__APP_VERSION__);
    hide();
  };

  return (
    <>
      {card === "update" && (
        <PromptCard
          title="App updated"
          secondaryLabel="Dismiss"
          onSecondary={closeUpdate}
          primaryLabel="What's New"
          onPrimary={() => {
            closeUpdate();
            setIsChangelogOpen(true);
          }}
        >
          Open Keep was just updated to {__APP_VERSION__}. Would you like to see the release notes?
        </PromptCard>
      )}
      {card === "support" && (
        <PromptCard
          title="Enjoying Open Keep?"
          secondaryLabel="Maybe later"
          onSecondary={hide}
          primaryLabel="Donate"
          onPrimary={() => {
            snoozeLaunchPrompt(SUPPORT_PROMPT, AFTER_DONATE_DELAY_MS);
            hide();
            window.open(KOFI_URL, "_blank");
          }}
        >
          Open Keep is free and open source. A donation helps keep it that way.
        </PromptCard>
      )}
      <ChangelogDialog
        open={isChangelogOpen}
        onOpenChange={setIsChangelogOpen}
        showTrigger={false}
      />
      <FeedbackDialog
        isOpen={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        onSubmit={submitFeedback}
      />
    </>
  );
};

export default LaunchCard;

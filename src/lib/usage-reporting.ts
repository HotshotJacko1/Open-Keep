// Copyright (c) 2026. Licensed under AGPLv3.
//
// Everything Open Keep sends to its Supabase project about a (anonymous) user:
//  - `last_login`, at most once a day, so cleanup_old_users can remove rows of
//    people who stopped using the app (it deletes those idle for 3 months);
//  - feedback, only when the person submits it.
// When to ask for feedback is decided on the device (launch-prompts.ts).
import { supabase } from "@/integrations/supabase/client";
import {
    FEEDBACK_PROMPT,
    feedbackStateFromServer,
    readLaunchPromptState,
    writeLaunchPromptState,
} from "@/lib/launch-prompts";

const LAST_LOGIN_REPORTED_KEY = "last-login-reported";
const FEEDBACK_PROMPT_SEEDED_KEY = "feedback-prompt-seeded";

const TABLE = "open_keep_user_entitlements";

const today = (now: Date) => now.toISOString().split("T")[0];

/** Whether `last_login` still needs sending today; at most once per UTC day. */
export const shouldReportLastLogin = (
    now: Date,
    storage: Pick<Storage, "getItem"> = localStorage,
): boolean => {
    try {
        return storage.getItem(LAST_LOGIN_REPORTED_KEY) !== today(now);
    } catch {
        return true;
    }
};

const reportLastLogin = async (userId: string, now: Date) => {
    if (!shouldReportLastLogin(now)) return;
    const { error } = await supabase
        .from(TABLE)
        .upsert({ user_id: userId, last_login: now.toISOString() }, { onConflict: "user_id" });
    if (error) {
        console.error("Failed to record last login:", error.message);
        return;
    }
    try {
        localStorage.setItem(LAST_LOGIN_REPORTED_KEY, today(now));
    } catch {
        // Not remembered: sent again next launch.
    }
};

/** One-off: carry the server's old feedback timing over to the device. */
const seedFeedbackPromptFromServer = async (userId: string) => {
    if (localStorage.getItem(FEEDBACK_PROMPT_SEEDED_KEY)) return;
    const { data, error } = await supabase
        .from(TABLE)
        .select("created_at, feedback_date")
        .eq("user_id", userId)
        .maybeSingle();
    if (error) {
        console.error("Failed to read feedback history:", error.message);
        return;
    }
    if (data?.created_at) {
        const createdAt = Date.parse(data.created_at);
        const lastAskedAt = data.feedback_date ? Date.parse(data.feedback_date) : null;
        if (Number.isFinite(createdAt)) {
            writeLaunchPromptState(
                FEEDBACK_PROMPT,
                feedbackStateFromServer(
                    readLaunchPromptState(FEEDBACK_PROMPT),
                    createdAt,
                    Number.isFinite(lastAskedAt) ? lastAskedAt : null,
                ),
            );
        }
    }
    localStorage.setItem(FEEDBACK_PROMPT_SEEDED_KEY, "true");
};

/** Run once a session exists. Failures are logged and retried next launch. */
export const reportLaunch = async (userId: string): Promise<void> => {
    try {
        await seedFeedbackPromptFromServer(userId);
        await reportLastLogin(userId, new Date());
    } catch (err) {
        console.error("Usage reporting failed", err);
    }
};

export const submitFeedback = async (feedback: "happy" | "sad", comments: string): Promise<void> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { error } = await supabase.from(TABLE).upsert({
        user_id: session.user.id,
        feedback,
        feedback_comments: comments,
        feedback_date: today(new Date()),
    }, { onConflict: "user_id" });
    if (error) console.error("Failed to send feedback:", error.message);
};

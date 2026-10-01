// Copyright (c) 2026. Licensed under AGPLv3.
// Session Replay, in its own module so main.tsx can import() it after startup and
// keep the recorder out of the startup bundle. Must come from @sentry/react: unlike
// browserTracingIntegration, @sentry/capacitor does not re-export replayIntegration.
export { replayIntegration } from "@sentry/react";

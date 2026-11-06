/**
 * @file The panels that look back at runs: what they spent (Usage), what a
 *   node's session is told (Context), and what got in their way (Feedback).
 *   Each one's title, icon and body, for the panel list in panels.tsx.
 */

import { IconContext, IconFeedback, IconUsage } from "../components/icons.tsx";
import { ContextPanel } from "../panels/context-panel.tsx";
import { FeedbackPanel } from "../panels/feedback-panel.tsx";
import { UsagePanel } from "../panels/usage-panel.tsx";

type Entry = {
  title: string;
  Icon: typeof IconUsage;
  Body: typeof UsagePanel;
};

export const REVIEW_PANELS = {
  usage: { title: "Usage", Icon: IconUsage, Body: UsagePanel },
  context: { title: "Context", Icon: IconContext, Body: ContextPanel },
  feedback: { title: "Feedback", Icon: IconFeedback, Body: FeedbackPanel },
} satisfies Record<string, Entry>;

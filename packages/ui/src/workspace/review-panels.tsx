/**
 * @file The panels that look back at runs: what they spent (Usage), what a
 *   node's session is told (Context), what got in their way (Feedback), and the
 *   worktrees and branches they left (Worktrees), and what they left for later
 *   (Follow-ups). Each one's title, icon and body, for the panel list in
 *   panels.tsx.
 */

import {
  IconContext,
  IconFeedback,
  IconFollowUps,
  IconUsage,
  IconWorktrees,
} from "../components/icons.tsx";
import { ContextPanel } from "../panels/context-panel.tsx";
import { FeedbackPanel } from "../panels/feedback-panel.tsx";
import { FollowUpsPanel } from "../panels/followups-panel.tsx";
import { UsagePanel } from "../panels/usage-panel.tsx";
import { WorktreesPanel } from "../panels/worktrees-panel.tsx";

type Entry = {
  title: string;
  Icon: typeof IconUsage;
  Body: typeof UsagePanel;
};

export const REVIEW_PANELS = {
  usage: { title: "Usage", Icon: IconUsage, Body: UsagePanel },
  context: { title: "Context", Icon: IconContext, Body: ContextPanel },
  feedback: { title: "Feedback", Icon: IconFeedback, Body: FeedbackPanel },
  worktrees: { title: "Worktrees", Icon: IconWorktrees, Body: WorktreesPanel },
  followups: {
    title: "Follow-ups",
    Icon: IconFollowUps,
    Body: FollowUpsPanel,
  },
} satisfies Record<string, Entry>;

/**
 * @file What the API offers after runs: the feedback loop's routes
 *   (contract-feedback.ts) and the follow-ups' (contract-follow-ups.ts), joined
 *   so the contract reads one part for both.
 */

import {
  DriverIdSchema,
  FEEDBACK_API,
  type FeedbackResponses,
} from "./contract-feedback.ts";
import {
  FOLLOW_UPS_API,
  type FollowUpsResponses,
} from "./contract-follow-ups.ts";

export { DriverIdSchema };

export const AFTER_API = { ...FEEDBACK_API, ...FOLLOW_UPS_API } as const;

export type AfterResponses = FeedbackResponses & FollowUpsResponses;

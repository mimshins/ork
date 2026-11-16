/**
 * @file What `ork:onboard-propose` suggests, one workflow per entry
 *   (specs/cli/onboard-verbs.md#suggestions). The model drafts these from
 *   untrusted text and the driver may not enforce their shape (G21), so the
 *   `filter` verb parses each entry itself with this schema.
 */

import { z } from "zod";

const EvidenceSchema = z.union([
  z.strictObject({
    path: z.string().min(1).max(300),
    note: z.string().max(300).optional(),
  }),
  z.strictObject({
    commit: z.string().min(1).max(60),
    note: z.string().max(300).optional(),
  }),
]);

export const SuggestionSchema = z.strictObject({
  workflow: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u, "a lowercase slug"),
  why: z.string().min(1).max(600),
  decidedBy: z.string().min(1).max(200),
  caps: z.strictObject({
    budgetUsd: z.number().positive(),
    budgetTokens: z.number().int().positive(),
  }),
  evidence: z.array(EvidenceSchema).min(1).max(8),
  commands: z.array(z.string().min(1).max(300)).max(8).optional(),
  feedback: z.array(z.string().min(1).max(100)).max(8).optional(),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

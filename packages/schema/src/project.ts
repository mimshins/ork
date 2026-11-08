/**
 * @file A project's rules: `.ork/project.yaml` says what Ork may do on its own
 *   in the project (commit, merge, name branches and worktrees), the
 *   permissions and defaults every Claude node gets, and the context files
 *   every node reads. A workflow's `rules:` win over the project's. Every key
 *   is optional; what it leaves out is Ork's default behaviour.
 */

import { z } from "zod";

import {
  BudgetSchema,
  DriverSchema,
  EffortSchema,
  IsolationSchema,
  McpNamesSchema,
  ModelSchema,
  PracticesSchema,
  QuotasSchema,
  ToolRulesSchema,
  TimeoutSchema,
  TurnsSchema,
} from "./settings.ts";
import { stepFields } from "./steps.ts";

export const PROJECT_SCHEMA_VERSION = 1;

/** Settings every Claude node takes unless it (or its agent) sets its own. */
export const DefaultsSchema = z.strictObject({
  driver: DriverSchema.optional(),
  model: ModelSchema.optional(),
  effort: EffortSchema.optional(),
  isolation: IsolationSchema.optional(),
  budgetUsd: BudgetSchema.optional(),
  maxTurns: TurnsSchema.optional(),
  timeout: TimeoutSchema.optional().describe(
    "For tool and Claude nodes that set none; a gate's own timeout is separate.",
  ),
  practices: PracticesSchema.optional(),
  mcp: McpNamesSchema,
  before: stepFields.before,
});
export type Defaults = z.infer<typeof DefaultsSchema>;

/** What the placeholders in a git template may name. */
export const TEMPLATE_VARIABLES = ["run", "node", "clone"] as const;

export const DEFAULT_BRANCH_TEMPLATE = "ork/{run}/{node}";
export const DEFAULT_WORKTREES_TEMPLATE =
  "../{clone}-worktrees/ork-{run}-{node}";

export const GitRulesSchema = z.strictObject({
  commit: z
    .enum(["auto", "never"])
    .optional()
    .describe(
      "Default: auto, Ork commits a node's work on its branch. never: Ork runs no git commit; worktrees are detached and work stays uncommitted.",
    ),
  merge: z
    .enum(["auto", "patch", "never"])
    .optional()
    .describe(
      "How a passing child's work reaches its owner. auto: a --no-ff merge (needs commits). patch: its changes are applied, uncommitted. never: left in its own worktree. Default: auto, or patch under commit: never.",
    ),
  base: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The commit worktrees without an owner start from, e.g. origin/main. Default: HEAD. Ork never fetches.",
    ),
  branch: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Branch name template over {run}, {node}, {clone} and {inputs.<name>}. Default: ork/{run}/{node}.",
    ),
  worktrees: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Worktree folder template, relative to the clone, beside it. Default: ../{clone}-worktrees/ork-{run}-{node}.",
    ),
});
export type GitRules = z.infer<typeof GitRulesSchema>;

/** Git rules with Ork's defaults filled in. */
export type ResolvedGitRules = {
  commit: "auto" | "never";
  merge: "auto" | "patch" | "never";
  base: string;
  branch: string;
  worktrees: string;
};

/** The rules a project sets, and a workflow overrides key by key. */
export const RulesSchema = z.strictObject({
  git: GitRulesSchema.optional(),
  permissions: ToolRulesSchema.optional().describe(
    "Tool rules every Claude node gets on top of its own, e.g. deny: ['Bash(git push *)'].",
  ),
  links: z
    .enum(["on", "off"])
    .optional()
    .describe(
      "Default: on, the user can link a running node to a node of another run. off: its nodes get no message tools unless they have someone to write to, and cannot be linked.",
    ),
});
export type Rules = z.infer<typeof RulesSchema>;

export const ProjectSchema = z.strictObject({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  ...RulesSchema.shape,
  defaults: DefaultsSchema.optional().describe(
    "Defaults for every workflow in the project; a workflow's own win.",
  ),
  quotas: QuotasSchema.optional().describe(
    "Most this project may spend on this machine. The user's own caps apply too.",
  ),
  calls: z
    .strictObject({
      accept: z
        .array(z.string())
        .describe(
          "The registered projects whose workflows may call this one's.",
        ),
    })
    .optional()
    .describe("Default: any registered project may call this one's workflows."),
  context: z
    .array(z.string())
    .optional()
    .describe(
      "Context files every node reads, relative to the project root; they come before the workflow's.",
    ),
  experimental: z
    .array(z.string())
    .optional()
    .describe("Experimental features this project turns on."),
});
export type Project = z.infer<typeof ProjectSchema>;

/** `~/.ork/settings.yaml`: the user's own settings, and never a credential. */
export const UserSettingsSchema = z.strictObject({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  quotas: QuotasSchema.optional().describe(
    "Most to spend across every project on this machine.",
  ),
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;

export const SETTINGS_SCHEMA_URL =
  "https://raw.githubusercontent.com/mimshins/ork/main/packages/schema/settings.schema.json";

export const PROJECT_SCHEMA_URL =
  "https://raw.githubusercontent.com/mimshins/ork/main/packages/schema/project.schema.json";

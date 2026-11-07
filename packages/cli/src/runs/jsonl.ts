/**
 * @file `ork feedback export` and `import` (specs/feedback.md): feedback
 *   records as JSON lines, one record a line, so a team can move feedback
 *   between machines without GitHub. A line is checked before it's added (one
 *   from a newer Ork says so), and a record already here (its run and event) is
 *   skipped.
 */

import {
  FEEDBACK_KINDS,
  FEEDBACK_SEVERITIES,
  FEEDBACK_TARGETS,
  FEEDBACK_VERSION,
  type FeedbackRecord,
} from "@krapht/ork-core";
import { z } from "zod";

const Text = z.string();

const LineSchema = z.strictObject({
  feedbackVersion: z.literal(FEEDBACK_VERSION),
  runId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  at: z.string().min(1),
  node: z.string().min(1).optional(),
  feedback: z.strictObject({
    source: z.enum(["system", "agent", "human"]),
    kind: z.enum(FEEDBACK_KINDS),
    target: z.enum(FEEDBACK_TARGETS),
    severity: z.enum(FEEDBACK_SEVERITIES),
    title: Text.min(1),
    body: Text,
    evidence: z.array(Text),
    code: Text.optional(),
    fingerprint: z.string().regex(/^[0-9a-f]{8,64}$/u),
    origin: z.strictObject({
      // A workflow's name: never a path, as a lessons file is named by it.
      workflow: z
        .string()
        .regex(/^[a-z0-9][a-z0-9._-]*$/u)
        .optional(),
      workflowHash: Text.optional(),
      nodeType: Text.optional(),
      model: Text.optional(),
      driver: Text.optional(),
      version: Text.optional(),
    }),
  }),
});

export type FeedbackLine = z.infer<typeof LineSchema>;

/** Records as JSON lines, with the format's version on each. */
export const exportLines = (records: readonly FeedbackRecord[]): string =>
  records
    .map(({ id: _id, ...record }) =>
      JSON.stringify({ feedbackVersion: FEEDBACK_VERSION, ...record }),
    )
    .map(line => `${line}\n`)
    .join("");

/** Why a line from a newer Ork is left out, or `null` when it isn't one. */
const newerVersion = (value: unknown): string | null => {
  const version =
    value !== null && typeof value === "object"
      ? (Reflect.get(value, "feedbackVersion") as unknown)
      : undefined;
  return typeof version === "number" && version > FEEDBACK_VERSION
    ? `made by a newer Ork (\`feedbackVersion: ${String(version)}\`; this one reads ${String(FEEDBACK_VERSION)}). Upgrade with \`ork upgrade\`.`
    : null;
};

export type ParsedLines = {
  records: Omit<FeedbackRecord, "id">[];
  /** Why a line was left out, by its number. */
  problems: string[];
};

/** The records in a JSONL file's text, and what was wrong with the rest. */
export const parseLines = (text: string): ParsedLines => {
  const records: ParsedLines["records"] = [];
  const problems: string[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      problems.push(`line ${String(index + 1)}: not JSON`);
      continue;
    }
    const newer = newerVersion(value);
    if (newer !== null) {
      problems.push(`line ${String(index + 1)}: ${newer}`);
      continue;
    }
    const parsed = LineSchema.safeParse(value);
    if (!parsed.success) {
      const [issue] = parsed.error.issues;
      problems.push(
        `line ${String(index + 1)}: ${issue?.path.join(".") ?? ""} ${issue?.message ?? "isn't a feedback record"}`.trim(),
      );
      continue;
    }
    const { feedbackVersion: _version, node, feedback, ...rest } = parsed.data;
    const { code, origin, ...report } = feedback;
    records.push({
      ...rest,
      ...(node === undefined ? {} : { node }),
      feedback: {
        ...report,
        ...(code === undefined ? {} : { code }),
        origin: Object.fromEntries(
          Object.entries(origin).filter(([, v]) => v !== undefined),
        ),
      },
    });
  }
  return { records, problems };
};

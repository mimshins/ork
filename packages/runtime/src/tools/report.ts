/**
 * @file The `report` tool: how a session hands Ork its final report when its
 *   driver cannot hold the final answer to a JSON Schema itself (`reportSchema`
 *   false, RFC-014). The report is checked against the node's report schema
 *   with zod; a report that breaks it comes back to the model as a tool error
 *   naming each violation, so it can fix it and call again. One that fits is
 *   kept as the session's report, and the session runner ends the session with
 *   it instead of what the tool's last line says.
 */

import { parseReport } from "@krapht/ork-core";
import { AGENT_DRIVERS } from "@krapht/ork-integrations";
import type { Driver } from "@krapht/ork-schema";
import { z } from "zod";

import {
  type BoundTool,
  type OrkTool,
  readableIssues,
  text,
  type ToolContext,
} from "./tool.ts";

export const REPORT_TOOL = "report";

/** Whether the driver holds a session's final answer to its schema itself. */
const checksItsReport = (driver: Driver): boolean =>
  AGENT_DRIVERS.find(d => d.id === driver)?.capabilities.reportSchema ?? true;

/**
 * The report schema as zod. shortcut: a schema zod cannot read takes any
 * object, and `parseReport` still demands a status and a summary; upgrade if a
 * node's `output.schema` ever uses JSON Schema zod does not support.
 */
const reportValidator = (schema: Record<string, unknown>): z.ZodType => {
  try {
    return z.fromJSONSchema(schema);
  } catch {
    return z.record(z.string(), z.unknown());
  }
};

const failed = (why: string) => ({
  ...text(
    `The report was not accepted; fix it and call ${REPORT_TOOL} again.\n${why}`,
  ),
  isError: true,
});

const bound = (report: NonNullable<ToolContext["report"]>): BoundTool => {
  const schema = reportValidator(report.schema);
  return {
    name: REPORT_TOOL,
    description:
      "Hand in your final report: call this once your work is done, as your last step, with the report the task asks for. A report that does not fit comes back with what to fix; call again with the fixed report. The last report accepted is the one your owner gets.",
    shape: schema instanceof z.ZodObject ? schema.shape : {},
    schema,
    preapproved: true,
    call: args => {
      const parsed = schema.safeParse(args, { reportInput: true });
      if (!parsed.success) {
        return Promise.resolve(failed(readableIssues(parsed.error.issues)));
      }
      const kept = parseReport(parsed.data);
      if (kept === null) {
        return Promise.resolve(
          failed("A report needs a `status` and a `summary`."),
        );
      }
      report.submit(kept);
      return Promise.resolve(
        text(
          "Report accepted. End your turn now; there is nothing more to do.",
        ),
      );
    },
  };
};

export const reportTool: OrkTool = {
  name: REPORT_TOOL,
  bind: context =>
    context.report === undefined || checksItsReport(context.driver)
      ? null
      : bound(context.report),
};

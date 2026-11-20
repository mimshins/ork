/**
 * @file What a session hands its tools about its rules (RFC-028): the `Read(…)`
 *   patterns its deny list holds, and the rules the `permission` tool judges a
 *   shell line by (the spec's lists and `unlisted`, whether the run is yolo,
 *   how it reads).
 */

import type { SessionSpec } from "@krapht/ork-core";

import { readPatterns } from "./tools/contain.ts";
import type { ToolContext } from "./tools/tool.ts";

export const sessionRules = (
  spec: SessionSpec,
): Required<Pick<ToolContext, "denyRead" | "rules">> => ({
  denyRead: readPatterns(spec.tools.deny),
  rules: { ...spec.tools, yolo: spec.yolo, reading: spec.reading },
});

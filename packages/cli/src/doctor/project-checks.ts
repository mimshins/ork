/**
 * @file What `ork doctor` says of the project it runs in: its tool folders'
 *   links, and its copies of Ork's skills for Claude Code (RFC-012).
 */

import type { CheckResult } from "@krapht/ork-integrations";

import { ORK_VERSION } from "../__build_info__.ts";
import { skillChecks } from "../project/init-skills.ts";
import { linkChecks } from "../project/link.ts";

export const projectChecks = (root: string): CheckResult[] => [
  ...linkChecks(root),
  ...skillChecks(root, ORK_VERSION),
];

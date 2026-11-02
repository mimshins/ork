/**
 * @file The UI tests' accessibility check: runs axe-core on a rendered
 *   container and returns the serious and critical violations, by rule and the
 *   elements they hit.
 */

import axe from "axe-core";

export type Violation = { rule: string; impact: string; nodes: string[] };

export const violations = async (root: Element): Promise<Violation[]> => {
  const result = await axe.run(root, {
    // jsdom has no layout, so color contrast is checked on the tokens.
    rules: { "color-contrast": { enabled: false } },
  });
  return result.violations
    .filter(v => v.impact === "serious" || v.impact === "critical")
    .map(v => ({
      rule: v.id,
      impact: v.impact ?? "",
      nodes: v.nodes.map(n => n.html),
    }));
};

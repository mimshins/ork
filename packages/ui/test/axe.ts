/**
 * @file The UI tests' accessibility check: runs axe-core on a rendered
 *   container and returns the moderate, serious and critical violations, by
 *   rule and the elements they hit. Moderate counts: a skipped heading level is
 *   one, and it is a real barrier to someone moving by headings.
 */

import axe from "axe-core";

export type Violation = { rule: string; impact: string; nodes: string[] };

export const violations = async (root: Element): Promise<Violation[]> => {
  const result = await axe.run(root, {
    // jsdom has no layout, so color contrast is checked on the tokens. A test
    // renders a part, not the page, so "all content in a landmark" can't hold;
    // the page's landmarks are checked in a browser.
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
    },
  });
  return result.violations
    .filter(v => v.impact !== "minor" && v.impact !== undefined)
    .map(v => ({
      rule: v.id,
      impact: v.impact ?? "",
      nodes: v.nodes.map(n => n.html),
    }));
};

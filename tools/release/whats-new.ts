/**
 * @file Cuts What's new at a release. The notes in Next release
 *   (`docs/whats-new/next-release.md`) move to a page named for the version
 *   being released, the hub lists that page first, and Next release starts
 *   empty again. `pnpm changesets:version` runs it, so the release pull request
 *   carries the cut. It does nothing when Next release is empty or the version
 *   already has a page.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { cliPackage } from "./build-info.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const HUB = path.join(ROOT, "docs", "whats-new.md");
const FOLDER = path.join(ROOT, "docs", "whats-new");
const NEXT = path.join(FOLDER, "next-release.md");

const PART_OF = "_Part of [What's new](../whats-new.md)._";
const NEXT_LINK = "- [Next release](./whats-new/next-release.md)";

/** What Next release says while nothing has landed since the last release. */
export const EMPTY_NEXT = `# Next release

${PART_OF}

Nothing yet: what lands on \`main\` is listed here until it ships.
`;

/** Next release's body: everything after its "Part of" line. */
const bodyOf = (next: string): string => {
  const at = next.indexOf(PART_OF);
  return at === -1 ? "" : next.slice(at + PART_OF.length).trim();
};

/** Whether a body holds any release note (a bullet or a section). */
const hasNotes = (body: string): boolean => /^(?:- |#{2,} )/mu.test(body);

/** GitHub's anchor for a heading's text. */
const anchorOf = (heading: string): string =>
  heading
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, "")
    .replaceAll(/\s/gu, "-");

export type Cut = { hub: string; next: string; page: string };

/**
 * The three files after cutting Next release into `version`'s page, or
 * `undefined` when Next release holds no notes. The hub lists the page right
 * under Next release, with the page's own `##` sections nested under it.
 */
export const cutRelease = (
  hub: string,
  next: string,
  version: string,
): Cut | undefined => {
  const body = bodyOf(next);
  if (!hasNotes(body)) return undefined;
  if (!hub.includes(NEXT_LINK)) {
    throw new Error(`docs/whats-new.md has no line "${NEXT_LINK}"`);
  }
  const file = `./whats-new/${version}.md`;
  const sections = [...body.matchAll(/^## (.+)$/gmu)].map(
    ([, title = ""]) => `  - [${title}](${file}#${anchorOf(title)})\n`,
  );
  const entry = `- [${version}](${file})\n${sections.join("")}`;
  return {
    hub: hub.replace(`${NEXT_LINK}\n`, `${NEXT_LINK}\n${entry}`),
    next: EMPTY_NEXT,
    page: `# ${version}\n\n${PART_OF}\n\n${body}\n`,
  };
};

if (import.meta.main) {
  const { version } = cliPackage();
  const page = path.join(FOLDER, `${version}.md`);
  const cut = existsSync(page)
    ? undefined
    : cutRelease(
        readFileSync(HUB, "utf8"),
        readFileSync(NEXT, "utf8"),
        version,
      );
  if (cut === undefined) {
    process.stdout.write(`What's new: nothing to cut for ${version}\n`);
  } else {
    writeFileSync(page, cut.page);
    writeFileSync(HUB, cut.hub);
    writeFileSync(NEXT, cut.next);
    process.stdout.write(`What's new: cut Next release into ${version}\n`);
  }
}

/**
 * @file Just enough Markdown for the docs check: headings and their GitHub
 *   anchors, and the relative links a file makes. Code fences and inline code
 *   are ignored.
 */

export type Heading = {
  depth: number;
  text: string;
  slug: string;
  line: number;
};

export type Link = { target: string; line: number };

const FENCE = /^\s*(```|~~~)/u;

/** The lines of a file outside code fences, with their 1-based numbers. */
const proseLines = (text: string): { line: number; value: string }[] => {
  const out: { line: number; value: string }[] = [];
  let inFence = false;
  for (const [index, value] of text.split("\n").entries()) {
    if (FENCE.test(value)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push({ line: index + 1, value });
  }
  return out;
};

/** Heading text as GitHub renders it: no links, emphasis or code marks. */
const plainHeading = (text: string): string =>
  text
    .replaceAll(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replaceAll(/`([^`]*)`/gu, "$1")
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll(/[*_]{1,3}([^*_]+)[*_]{1,3}/gu, "$1")
    .trim();

/** GitHub's anchor for a heading (github-slugger), without the duplicate suffix. */
export const slugify = (text: string): string =>
  plainHeading(text)
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replaceAll(" ", "-");

export const headings = (text: string): Heading[] => {
  const seen = new Map<string, number>();
  const out: Heading[] = [];
  for (const { line, value } of proseLines(text)) {
    const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/u.exec(value);
    if (match === null) continue;
    const [, hashes = "", raw = ""] = match;
    const base = slugify(raw);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    out.push({
      depth: hashes.length,
      text: plainHeading(raw),
      slug: count === 0 ? base : `${base}-${String(count)}`,
      line,
    });
  }
  return out;
};

/** Every anchor a file defines: heading slugs and `<a id="…">` / `name`. */
export const anchors = (text: string): Set<string> => {
  const found = new Set(headings(text).map(h => h.slug));
  for (const match of text.matchAll(/<a\s+(?:id|name)="([^"]+)"/gu)) {
    if (match[1] !== undefined) found.add(match[1]);
  }
  return found;
};

const withoutInlineCode = (value: string): string =>
  value.replaceAll(/`[^`]*`/gu, "");

/** Inline links and images whose target is not a URL. */
export const relativeLinks = (text: string): Link[] => {
  const out: Link[] = [];
  for (const { line, value } of proseLines(text)) {
    for (const match of withoutInlineCode(value).matchAll(
      /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/gu,
    )) {
      const target = match[1] ?? "";
      if (/^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith("/")) {
        continue;
      }
      out.push({ target, line });
    }
  }
  return out;
};

/**
 * @file The docs check: links, anchors, and the hub/chunk structure of long
 *   documents. Run with `pnpm docs:check`; the procedure is
 *   `runbook/development/docs.md`.
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { anchors, headings, relativeLinks } from "./markdown.ts";

/** Folders whose documents follow the hub/chunk rule. */
export const STRUCTURED = ["specs", "docs", "runbook"] as const;

/** Paths the check never reads: dependencies, local-only and app files. */
export const SKIPPED = [
  ".git",
  ".ai/specs",
  "docs/interaction-map/public",
] as const;

/** Folders with their own layout: links are checked, structure is not. */
export const UNSTRUCTURED = ["docs/interaction-map"] as const;

export const HUB_LIMIT = 200;
export const CHUNK_LIMIT = 280;

const PART_OF = /^_Part of \[[^\]]+\]\(([^)#]+\.md)\)\._$/u;
const CONTENTS = "contents";

const under = (relative: string, prefix: string): boolean =>
  relative === prefix || relative.startsWith(`${prefix}/`);

const skipped = (relative: string): boolean =>
  relative.split("/").includes("node_modules") ||
  SKIPPED.some(s => under(relative, s));

/** Every Markdown file under `root`, repository-relative, sorted. */
export const markdownFiles = (root: string, dir = ""): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(path.join(root, dir)).toSorted()) {
    const relative = dir === "" ? name : `${dir}/${name}`;
    if (skipped(relative)) continue;
    const stat = lstatSync(path.join(root, relative));
    // A symlink (such as .claude/skills -> ../.ai/skills) is checked at its
    // target, once.
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      out.push(...markdownFiles(root, relative));
    } else if (name.endsWith(".md")) {
      out.push(relative);
    }
  }
  return out;
};

const lineCount = (text: string): number =>
  text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;

/** The links listed under a file's `## Contents`, resolved and without anchors. */
const contentsLinks = (file: string, text: string): Set<string> => {
  const lines = text.split("\n");
  const start = headings(text).find(
    h => h.depth === 2 && h.slug === CONTENTS,
  )?.line;
  const listed = new Set<string>();
  if (start === undefined) return listed;
  for (const value of lines.slice(start)) {
    if (/^#{1,2}\s/u.test(value)) break;
    for (const match of value.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/gu)) {
      if (match[1] !== undefined) {
        listed.add(
          path.posix.normalize(
            path.posix.join(path.posix.dirname(file), match[1]),
          ),
        );
      }
    }
  }
  return listed;
};

const hasContents = (text: string): boolean =>
  headings(text).some(h => h.depth === 2 && h.slug === CONTENTS);

const inStructured = (file: string): boolean =>
  STRUCTURED.some(top => under(file, top)) &&
  !UNSTRUCTURED.some(prefix => under(file, prefix));

/**
 * Checks the documents under `root` and returns one message per problem.
 *
 * - Every relative link resolves, and every `#anchor` exists in its target.
 * - Under `specs/`, `docs/`, `runbook/`: a document over 200 lines is a hub with
 *   `## Contents` and a sibling folder of chunks; a chunk is one folder level
 *   deep, starts with `_Part of [Hub](…)._` under its H1, is listed in that
 *   hub's contents, and stays under 280 lines (or becomes a section hub in the
 *   same folder).
 */
export const checkDocs = (root: string): string[] => {
  const errors: string[] = [];
  const files = markdownFiles(root);
  const texts = new Map(
    files.map(f => [f, readFileSync(path.join(root, f), "utf8")]),
  );
  const anchorCache = new Map<string, Set<string>>();
  const anchorsOf = (file: string): Set<string> => {
    const cached = anchorCache.get(file);
    if (cached !== undefined) return cached;
    const found = anchors(
      texts.get(file) ?? readFileSync(path.join(root, file), "utf8"),
    );
    anchorCache.set(file, found);
    return found;
  };

  for (const [file, text] of texts) {
    for (const link of relativeLinks(text)) {
      const [target = "", anchor] = link.target.split("#");
      const resolved =
        target === ""
          ? file
          : path.posix.normalize(
              path.posix.join(path.posix.dirname(file), decodeURI(target)),
            );
      const where = `${file}:${String(link.line)}`;
      if (!existsSync(path.join(root, resolved))) {
        errors.push(`${where}: broken link ${link.target}`);
        continue;
      }
      if (
        anchor !== undefined &&
        anchor !== "" &&
        resolved.endsWith(".md") &&
        !anchorsOf(resolved).has(anchor)
      ) {
        errors.push(`${where}: ${resolved} has no anchor #${anchor}`);
      }
    }

    if (!inStructured(file)) continue;
    const parts = file.split("/");
    const lines = lineCount(text);

    const folder = parts.slice(0, -1).join("/");
    const hub = `${folder}.md`;
    const partOf = text
      .split("\n")
      .slice(0, 6)
      .map(l => PART_OF.exec(l.trim()))
      .find(m => m !== null);
    // A chunk lives in <hub>/ beside <hub>.md, or says whose part it is. A
    // folder with neither (runbook/development/) groups standalone documents.
    const isChunk =
      parts.length >= 3 && (texts.has(hub) || partOf !== undefined);

    if (isChunk) {
      if (!texts.has(hub)) {
        errors.push(`${file}: chunk folder ${folder}/ has no hub ${hub}`);
        continue;
      }
      const grandparent = parts.slice(0, -2).join("/");
      if (texts.has(`${grandparent}.md`) && parts.length > 3) {
        errors.push(
          `${file}: chunks are one folder deep; use a section hub in ${parts.slice(0, -2).join("/")}/`,
        );
      }
      if (partOf?.[1] === undefined) {
        errors.push(
          `${file}: a chunk starts with "_Part of [<Hub>](<hub>.md)._" under its H1`,
        );
        continue;
      }
      const owner = path.posix.normalize(path.posix.join(folder, partOf[1]));
      if (!texts.has(owner)) {
        errors.push(`${file}: "Part of" points at missing ${owner}`);
      } else if (!contentsLinks(owner, texts.get(owner) ?? "").has(file)) {
        errors.push(`${file}: not listed in the ## Contents of ${owner}`);
      }
      if (lines > CHUNK_LIMIT && !hasContents(text)) {
        errors.push(
          `${file}: ${String(lines)} lines; split it into a section hub over ${String(CHUNK_LIMIT)}`,
        );
      }
    } else if (lines > HUB_LIMIT && !hasContents(text)) {
      errors.push(
        `${file}: ${String(lines)} lines; over ${String(HUB_LIMIT)}, split it into a hub and chunks`,
      );
    }
  }
  return errors;
};

const main = (): void => {
  const root = path.resolve(import.meta.dirname, "../..");
  const errors = checkDocs(root);
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`${error}\n`);
    process.stderr.write(
      `\n✗ ${String(errors.length)} documentation problem(s).\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    "✓ Documentation links, anchors and structure are consistent.\n",
  );
};

if (import.meta.main) main();

/**
 * @file Closes a shipped RFC: sets its status to `Implemented`, moves it from
 *   `rfcs/active/` to `rfcs/archived/`, and updates its row in the index and
 *   every Markdown link to it, the mechanical steps of the RFC lifecycle
 *   (`rfcs/README.md`). The ADR is written by hand. Usage: `pnpm rfc:close
 *   RFC-013`.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/** Folders that hold no documents of ours. */
const SKIPPED = new Set(["node_modules", ".git", "dist", "runs"]);

/** An Accepted RFC's text set to `Implemented`; undefined for any other. */
export const markImplemented = (text: string): string | undefined => {
  const pattern = /^- \*\*Status:\*\* Accepted.*$/mu;
  return pattern.test(text)
    ? text.replace(pattern, "- **Status:** Implemented")
    : undefined;
};

/** Pads `cell` back to the width of `old`, keeping the table's columns. */
const fit = (cell: string, old: string): string => cell.padEnd(old.length);

/** The index with `file`'s row pointing at `archived/`, as `Implemented`. */
export const closeInIndex = (
  index: string,
  file: string,
): string | undefined => {
  const lines = index.split("\n");
  const at = lines.findIndex(line => line.includes(`(./active/${file})`));
  const row = lines[at];
  if (row === undefined) {
    return undefined;
  }
  const cells = row.split("|");
  const link = cells[1];
  const status = cells[3];
  if (cells.length !== 5 || link === undefined || status === undefined) {
    return undefined;
  }
  cells[1] = fit(
    `${link.replace("./active/", "./archived/").trimEnd()} `,
    link,
  );
  cells[3] = fit(" Implemented ", status);
  lines[at] = cells.join("|");
  return lines.join("\n");
};

/** Every Markdown file under `dir`. */
const markdownUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED.has(entry.name) ? [] : markdownUnder(full);
    }
    return entry.name.endsWith(".md") ? [full] : [];
  });

/** Repoints every Markdown link to `file` under `root` at `archived/`. */
const repointLinks = (root: string, file: string): void => {
  const from = `active/${file}`;
  for (const doc of markdownUnder(root)) {
    const text = readFileSync(doc, "utf8");
    if (text.includes(from)) {
      writeFileSync(doc, text.split(from).join(`archived/${file}`));
    }
  }
};

/** Closes the RFC named `id` under `root`; returns a problem, if there is one. */
export const closeRfc = (root: string, id: string): string | undefined => {
  const active = path.join(root, "rfcs", "active");
  const archived = path.join(root, "rfcs", "archived");
  const indexPath = path.join(root, "rfcs", "README.md");
  const file = existsSync(active)
    ? readdirSync(active).find(name => name.startsWith(`${id}-`))
    : undefined;
  if (file === undefined) {
    return `${id} is not in rfcs/active/.`;
  }
  const source = path.join(active, file);
  const target = path.join(archived, file);
  const text = markImplemented(readFileSync(source, "utf8"));
  if (text === undefined) {
    return `${file} is not Accepted.`;
  }
  const index = closeInIndex(readFileSync(indexPath, "utf8"), file);
  if (index === undefined) {
    return `rfcs/README.md has no row for ${file}.`;
  }
  renameSync(source, target);
  writeFileSync(target, text);
  writeFileSync(indexPath, index);
  repointLinks(root, file);
  return undefined;
};

if (import.meta.main) {
  const id = process.argv[2] ?? "";
  const problem = /^RFC-\d+$/u.test(id)
    ? closeRfc(process.cwd(), id)
    : "Usage: pnpm rfc:close RFC-NNN";
  if (problem !== undefined) {
    console.error(problem);
    process.exitCode = 1;
  }
}

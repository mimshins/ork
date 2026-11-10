/**
 * @file `pnpm benchmark:publish <folder> [name…]`: copies benchmarks from the
 *   private folder `pnpm benchmark` writes into the repository's public
 *   `benchmarks/`, with only what may be published (public.ts): the README, the
 *   allowed `summary.json` fields, `usage.csv`, and under `inputs/` the brief
 *   (cut before an embedded plan) and the workflow and agent files. It then
 *   writes `results.json` and the README's results table from every published
 *   benchmark and the private `control.json`'s aggregates. Everything is staged
 *   and scanned first; one finding and nothing is written. With no names, it
 *   publishes every benchmark in the folder that has a README.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { expandHome, type Json, parse, rec } from "./json.ts";
import { resultsOf, resultsTable, withTable } from "./public-report.ts";
import {
  allowedFile,
  findings,
  localNames,
  PUBLIC_DIR,
  publicSummary,
} from "./public.ts";

/** The brief up to an embedded document (a plan pasted in), which stays out. */
export const publicBrief = (brief: string): string => {
  const cut = brief.search(/^# /mu);
  const own = (cut === -1 ? brief : brief.slice(0, cut)).trim();
  if (cut === -1) return `${own}\n`;
  return own === ""
    ? "The brief was the approved plan itself, which is not published; the README says what it asked for.\n"
    : `${own}\n\nThe rest of this input was the approved plan, which is not published.\n`;
};

/** Every file under `dir` but dotfiles, as paths relative to it. */
const filesUnder = (dir: string, prefix = ""): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter(entry => !entry.name.startsWith("."))
        .flatMap(entry =>
          entry.isDirectory()
            ? filesUnder(path.join(dir, entry.name), `${prefix}${entry.name}/`)
            : [`${prefix}${entry.name}`],
        )
    : [];

const json = (value: unknown): string =>
  `${JSON.stringify(value, undefined, 2)}\n`;

/** One benchmark's public files, by path inside `benchmarks/`. */
const stage = (from: string, name: string): Map<string, string> => {
  const read = (file: string) => readFileSync(path.join(from, file), "utf8");
  const summary = rec(parse(read("summary.json")));
  const staged = new Map<string, string>([
    [`${name}/README.md`, read("README.md")],
    [
      `${name}/summary.json`,
      json(publicSummary({ ...summary, benchmark: name })),
    ],
    [`${name}/usage.csv`, read("usage.csv")],
  ]);
  if (existsSync(path.join(from, "brief.md"))) {
    staged.set(`${name}/inputs/brief.md`, publicBrief(read("brief.md")));
  }
  for (const file of filesUnder(path.join(from, "workflow"))) {
    staged.set(
      `${name}/inputs/workflow/${file}`,
      read(path.join("workflow", file)),
    );
  }
  return staged;
};

/** Why `staged` can't be published; empty when it can. */
const problemsOf = (staged: ReadonlyMap<string, string>): string[] => {
  const names = localNames();
  return [...staged].flatMap(([file, body]) => {
    const found = findings(body, names).map(what => `${file}: holds ${what}`);
    if (!allowedFile(file))
      found.push(`${file}: not a file a benchmark may hold`);
    return found;
  });
};

/** The names to publish: those given, else every one with a README. */
const namesIn = (folder: string, given: readonly string[]): string[] =>
  given.length > 0
    ? [...given]
    : readdirSync(folder, { withFileTypes: true })
        .filter(
          e =>
            e.isDirectory() &&
            existsSync(path.join(folder, e.name, "README.md")) &&
            existsSync(path.join(folder, e.name, "summary.json")),
        )
        .map(e => e.name)
        .toSorted();

const publish = (folder: string, given: readonly string[], repo: string) => {
  const out = path.join(repo, PUBLIC_DIR);
  const staged = new Map<string, string>();
  for (const name of namesIn(folder, given)) {
    for (const [file, body] of stage(path.join(folder, name), name)) {
      staged.set(file, body);
    }
  }
  const control = rec(
    parse(readFileSync(path.join(folder, "control.json"), "utf8")),
  );
  const published = new Set(
    [...staged.keys()].map(file => file.split("/")[0] ?? ""),
  );
  const summaries: Json[] = [
    ...[...staged]
      .filter(([file]) => file.endsWith("/summary.json"))
      .map(([, body]) => rec(parse(body))),
    ...readdirSync(out, { withFileTypes: true })
      .filter(e => e.isDirectory() && !published.has(e.name))
      .map(e => path.join(out, e.name, "summary.json"))
      .filter(file => existsSync(file))
      .map(file => rec(parse(readFileSync(file, "utf8")))),
  ];
  const results = resultsOf(summaries, control);
  staged.set("results.json", json(results));
  const readme = readFileSync(path.join(out, "README.md"), "utf8");
  staged.set("README.md", withTable(readme, resultsTable(results)));
  const problems = problemsOf(staged);
  if (problems.length > 0) return problems;
  for (const name of published) {
    rmSync(path.join(out, name), { recursive: true, force: true });
  }
  for (const [file, body] of staged) {
    mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    writeFileSync(path.join(out, file), body);
  }
  execFileSync("pnpm", ["exec", "oxfmt", PUBLIC_DIR], {
    cwd: repo,
    stdio: "ignore",
  });
  console.log(`Published ${[...published].join(", ")} to ${PUBLIC_DIR}/.`);
  return [];
};

const run = (): void => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { repo: { type: "string" } },
  });
  const [folder, ...names] = positionals;
  if (folder === undefined) {
    console.error("Usage: pnpm benchmark:publish <folder> [name…] [--repo]");
    process.exitCode = 1;
    return;
  }
  const problems = publish(
    expandHome(folder, homedir()),
    names,
    values.repo ?? process.cwd(),
  );
  if (problems.length > 0) {
    console.error(`Nothing was published:\n${problems.join("\n")}`);
    process.exitCode = 1;
  }
};

if (import.meta.main) run();

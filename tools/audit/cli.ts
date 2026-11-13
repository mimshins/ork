/**
 * @file The command line the `audit` workflow's `tool.shell` nodes call: `node
 *   tools/audit/cli.ts <subcommand>`. Scalars come from the environment
 *   (`PROFILE`, `SCOPE`, `ORK_RUN`; `ORK_AUDIT_HOME` and `ORK_AUDIT_PROJECT`
 *   move the output folder); a subcommand that takes structured data reads one
 *   JSON object from `AUDIT_INPUT`, or from stdin when that is unset. Each
 *   prints one JSON document on stdout. A failure prints its message on stderr
 *   and exits 1, with nothing on stdout.
 *
 *   - `check-inputs`: `{ profile, scope }`, or fails naming the allowed values.
 *   - `scan`: the inputs, the free scanners' `findings`, and the previous audit.
 *   - `ledger`: `{ units }` in; writes `run-metadata.json` and
 *     `coverage-ledger.json`; prints the `hunt` list.
 *   - `consolidate`: `{ hunts, gaps? }` in; prints `unique` (to the verifiers)
 *     and `unreviewed` (`needs_validation` records).
 *   - `findings`: `{ results, unique }` (the verifiers' answers and the
 *     candidates they got), or `{ records }`, in; writes `findings.json`.
 *   - `finalize`: `{ rechecks }` in; applies the Phase 5 answers.
 *   - `report`: `{ posture, hardening, positive, scanner, notes, previous }` in;
 *     writes `REPORT.md`, `FINDINGS-DETAIL.md` and `NEEDS-VALIDATION.md`.
 *   - `where`: prints the run's output folder.
 *   - `discard`: removes the run's output folder.
 */

import { readFileSync, rmSync } from "node:fs";

import { runFinalize } from "./finalize.ts";
import { runConsolidate } from "./findings.ts";
import { checkInputs } from "./inputs.ts";
import { runLedger } from "./ledger.ts";
import { runReport } from "./report.ts";
import { runScan } from "./scan.ts";
import { outputDir } from "./store.ts";
import { runFindings } from "./verdicts.ts";

const structuredInput = (): Record<string, unknown> => {
  const raw = process.env["AUDIT_INPUT"] ?? readFileSync(0, "utf8");
  const data: unknown = JSON.parse(raw);
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("the input must be one JSON object");
  }
  return Object.fromEntries(Object.entries(data));
};

const asArray = (value: unknown): readonly unknown[] | undefined =>
  Array.isArray(value) ? value : undefined;

const commands: Record<string, (cwd: string) => unknown> = {
  "check-inputs": () =>
    checkInputs(process.env["PROFILE"], process.env["SCOPE"]),
  scan: cwd => {
    const result = runScan({ cwd, env: process.env });
    // A declared output holds no object, so the previous audit also comes as text.
    return {
      ...result,
      previousDir: result.previous?.dir ?? "",
      previousText:
        result.previous === null ? "none" : JSON.stringify(result.previous),
    };
  },
  ledger: cwd => {
    const units = asArray(structuredInput()["units"]);
    if (units === undefined) throw new Error("the input has no `units` list");
    return runLedger(cwd, process.env, { units });
  },
  consolidate: cwd => {
    const input = structuredInput();
    const hunts = asArray(input["hunts"]);
    if (hunts === undefined) throw new Error("the input has no `hunts` list");
    return runConsolidate(cwd, process.env, {
      hunts,
      gaps: asArray(input["gaps"]),
    });
  },
  findings: cwd => {
    const input = structuredInput();
    const records = asArray(input["records"]);
    const results = asArray(input["results"]);
    if (records === undefined && results === undefined) {
      throw new Error("the input has no `records` or `results` list");
    }
    return runFindings(cwd, process.env, {
      records,
      results,
      unique: asArray(input["unique"]),
    });
  },
  finalize: cwd =>
    runFinalize(cwd, process.env, {
      rechecks: asArray(structuredInput()["rechecks"]),
    }),
  report: cwd => {
    const input = structuredInput();
    const text = (key: string): string | undefined => {
      const value = input[key];
      return typeof value === "string" ? value : undefined;
    };
    return runReport(cwd, process.env, {
      posture: text("posture"),
      hardening: asArray(input["hardening"]),
      positive: asArray(input["positive"]),
      scanner: asArray(input["scanner"]),
      notes: asArray(input["notes"]),
      previous: text("previous") ?? null,
    });
  },
  where: cwd => ({
    outputDir: outputDir(cwd, process.env["ORK_RUN"] ?? "", process.env),
  }),
  discard: cwd => {
    const dir = outputDir(cwd, process.env["ORK_RUN"] ?? "", process.env);
    rmSync(dir, { recursive: true, force: true });
    return { discarded: dir };
  },
};

const main = (): void => {
  const command = commands[process.argv[2] ?? ""];
  if (command === undefined) {
    process.stderr.write(
      `Usage: node tools/audit/cli.ts <${Object.keys(commands).join("|")}>\n`,
    );
    process.exitCode = 2;
    return;
  }
  try {
    const result = command(process.cwd());
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
};

if (import.meta.main) main();

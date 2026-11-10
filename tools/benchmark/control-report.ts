/**
 * @file The control estimate's page, `CONTROL.md`: the manual rate, each
 *   benchmark beside its estimate, and what the estimate cannot say.
 */

export type Rate = {
  sessions: number;
  windows: number;
  commits: number;
  lines: number;
  usd: number;
  working_min: number;
  /** P25, median, p75, per 1,000 changed lines. */
  usd_per_kline: number[];
  min_per_kline: number[];
  from: string;
  to: string;
};

export type Estimate = {
  name: string;
  run: string;
  lines: number;
  ork_usd: number;
  ork_working_min: number;
  /** P25, median, p75. */
  manual_usd: number[];
  manual_working_min: number[];
};

const usd = (x: number | undefined): string => `$${(x ?? 0).toFixed(2)}`;
const n = (x: number): string => x.toLocaleString("en-US");
const min = (x: number | undefined): string => String(x ?? 0);

const CAVEATS = [
  "- **Lines are a weak measure of work.** Renames and moved docs are cheap per line, a subtle engine fix is dear, so the range is wide.",
  "- **The manual side includes planning.** Its windows hold design talk and plans as well as building, so it is likely a little high.",
  "- **Time is not one to one.** A manual session does one thing at a time and counts waits on a permission prompt inside a turn; Ork's builders run in parallel.",
  "- **Quality is not measured.** Ork's runs have a review loop; the manual commits passed the pre-push check.",
];

/** The page, from the rate and the estimates. */
export const controlMarkdown = (
  rate: Rate,
  estimates: readonly Estimate[],
): string =>
  [
    "# Control: the same work in plain Claude Code sessions",
    "",
    "What each benchmark's change would cost in plain Claude Code sessions on this machine, with their usual CLAUDE.md, MCP servers, memory, user settings and subagents, estimated from the repository's own transcripts by `pnpm benchmark:control` (`tools/benchmark/control.ts`, which says how). Data: `control.json`.",
    "",
    `The manual rate comes from ${n(rate.windows)} push windows in ${String(rate.sessions)} sessions (${rate.from} to ${rate.to}): ${n(rate.commits)} commits, ${n(rate.lines)} changed lines, ${usd(rate.usd)}, ${n(Math.round(rate.working_min))} working minutes.`,
    "",
    "| Per 1,000 changed lines | p25 | median | p75 |",
    "|---|---|---|---|",
    `| Cost | ${rate.usd_per_kline.map(x => usd(x)).join(" | ")} |`,
    `| Working minutes | ${rate.min_per_kline.map(x => min(x)).join(" | ")} |`,
    "",
    "| Benchmark | Lines | Ork cost | Manual cost, median (p25–p75) | Ork working min | Manual min, median (p25–p75) |",
    "|---|---|---|---|---|---|",
    ...estimates.map(
      e =>
        `| ${e.name} | ${n(e.lines)} | ${usd(e.ork_usd)} | ${usd(e.manual_usd[1])} (${usd(e.manual_usd[0])}–${usd(e.manual_usd[2])}) | ${min(e.ork_working_min)} | ${min(e.manual_working_min[1])} (${min(e.manual_working_min[0])}–${min(e.manual_working_min[2])}) |`,
    ),
    "",
    "## Caveats",
    "",
    ...CAVEATS,
    "",
  ].join("\n");

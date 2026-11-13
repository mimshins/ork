/**
 * @file The Monitor's account of how a run ended, under its stat strip: why it
 *   stopped, then what it produced (its declared outputs).
 */

import { RunEnds } from "./run-ends.tsx";
import { RunOutputs } from "./run-outputs.tsx";
import type { RunView } from "./use-run-monitor.ts";

export const RunSummary = ({
  run,
  roots,
  onSelect,
}: {
  run: RunView;
  roots: Parameters<typeof RunEnds>[0]["roots"];
  onSelect: (node: string) => void;
}) => (
  <>
    <RunEnds
      onSelect={onSelect}
      roots={roots}
      run={run}
    />
    <RunOutputs run={run} />
  </>
);

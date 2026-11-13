/**
 * @file What the Monitor reads of a run's declared outputs: once when the run
 *   ends (or when it is opened already over), again at its next end, and
 *   nothing while it runs. The stream's run list leaves them out, so they come
 *   from the run's own route.
 */

import type { OutputText, RunView } from "@krapht/ork-server/client";
import { useEffect, useState } from "react";

import { useAppState } from "../state/context.tsx";

export type RunOutputs =
  | { read: "none" }
  | { read: "some"; outputs: OutputText[] }
  | { read: "refused"; error: string };

const NONE: RunOutputs = { read: "none" };

const readOf = (outputs: OutputText[] | undefined): RunOutputs =>
  outputs === undefined ? NONE : { read: "some", outputs };

export const useRunOutputs = (run: RunView): RunOutputs => {
  const { client } = useAppState();
  const { id, live } = run;
  // One read for each end of one run; a read made for another end is not shown.
  const key = live === "running" || live === "paused" ? null : `${id} ${live}`;
  const [got, setGot] = useState<{ key: string; read: RunOutputs } | null>(
    null,
  );
  useEffect(() => {
    let current = true;
    const load = async () => {
      const answer = await client.call("run", { params: { id } });
      if (!current || key === null) return;
      const read: RunOutputs = answer.ok
        ? readOf(answer.data.outputs)
        : { read: "refused", error: answer.error };
      setGot({ key, read });
    };
    if (key !== null) void load();
    return () => {
      current = false;
    };
  }, [client, id, key]);
  return got !== null && got.key === key ? got.read : NONE;
};

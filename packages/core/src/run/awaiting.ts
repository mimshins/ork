/**
 * @file Which leaders are waiting on their children now: inside `delegate` or
 *   `spawn_worker`, where they read nothing until every child has reported. The
 *   message bus refuses a child's message to such a leader (`bus.ts`).
 */

export const createAwaiting = () => {
  /** Leader -> how many of its calls are waiting. */
  const calls = new Map<string, number>();
  return {
    /** `leader` waits until the returned function is called (once counts). */
    awaits: (leader: string): (() => void) => {
      calls.set(leader, (calls.get(leader) ?? 0) + 1);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        const left = (calls.get(leader) ?? 1) - 1;
        if (left > 0) calls.set(leader, left);
        else calls.delete(leader);
      };
    },
    waits: (leader: string): boolean => calls.has(leader),
  };
};

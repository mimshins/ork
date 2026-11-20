/**
 * @file Recognises a refusal by a driver's own guard in a tool result's text:
 *   the rules refusal (`Ork: <tool> is <why>. Do not retry it.`, from the
 *   matcher in `tool-rules-source.ts` as Command Code's mod and the `omp` guard
 *   word it) and the reading refusal (`Ork refuses …`, from `shell-reads.ts`).
 *   A decoder marks such a result `fault: "refused"`: the agent's context gap,
 *   not a failure of the tool. A pause, a stop, or a guard that could not check
 *   its rules is not a refusal.
 */

/** The guard's rules refusal; Codex drops the last period. */
const RULES_REFUSAL = /^Ork: \S+ is [^\n]+\. Do not retry it\.?$/u;

/** The reading refusal, of a shell line or of a Read. */
const READ_REFUSAL = /^Ork refuses \S/u;

/** Whether `text` is the guard's refusal of the call. */
export const isGuardRefusal = (text: string): boolean => {
  const said = text.trim();
  return RULES_REFUSAL.test(said) || READ_REFUSAL.test(said);
};

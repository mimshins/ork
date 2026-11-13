/**
 * @file The commands that act as the user refuse a program or an agent in a run
 *   (ADR-047), in the stores that run guards: the store of a nested run under a
 *   temp HOME is not guarded unless an enclosing run lists it. The refusal
 *   names the variable it saw, for someone at their own terminal who inherited
 *   it. It stops accidents; it is not a boundary.
 */

import { storePath } from "@krapht/ork-core";
import { runMarkerIn, storeGuarded } from "@krapht/ork-nodes";

const refusal = (
  why: string,
  env: NodeJS.ProcessEnv,
  store: string,
): string | null => {
  const marker = runMarkerIn(env);
  return marker === null || !storeGuarded(env, store)
    ? null
    : `${why} ${marker} is set here. If this is your own terminal, it inherited that from a program in a run (a tmux server started by one, say); open a shell without it.`;
};

/** Why `ork watch --accept` refuses here, or `null` when it may run. */
export const acceptRefusal = (
  env = process.env,
  store = storePath(),
): string | null =>
  refusal(
    "`ork watch --accept` approves code to run with nobody there, so a program or an agent in a run cannot use it.",
    env,
    store,
  );

/** Why `ork chat` refuses here, or `null` when it may run. */
export const chatRefusal = (
  env = process.env,
  store = storePath(),
): string | null =>
  refusal(
    "`ork chat` speaks as you, so a program or an agent in a run cannot use it. A program writes to a session with `ork send`.",
    env,
    store,
  );

/** Why `ork decide` will not answer here, or `null` when it may. */
export const decideRefusal = (
  env = process.env,
  store = storePath(),
): string | null =>
  refusal(
    "`ork decide` answers as you, so a program or an agent in a run cannot answer with it; `ork decide --list` still shows what is open.",
    env,
    store,
  );

/** Why `ork continue` refuses here, or `null` when it may run. */
export const continueRefusal = (
  env = process.env,
  store = storePath(),
): string | null =>
  refusal(
    "`ork continue` undoes a pause you set, so a program or an agent in a run cannot use it.",
    env,
    store,
  );

/** Whether `ork ui` may print its sign-in link, which acts as the user. */
export const mayShowSignIn = (
  env = process.env,
  store = storePath(),
): boolean => !storeGuarded(env, store);

/** Why `ork attach` will not answer here, or `null` when it may. */
export const attachRefusal = (
  env = process.env,
  store = storePath(),
): string | null =>
  refusal(
    "`ork attach` answers as you, so a program or an agent in a run cannot use it; `ork logs` still shows the run.",
    env,
    store,
  );

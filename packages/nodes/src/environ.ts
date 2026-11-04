/**
 * @file The user's environment as Ork reads it: a name is read only as the
 *   environment's own, as an expression reads them.
 */

export type Environ = Readonly<Record<string, string | undefined>>;

/** A variable of the user's. */
export const readEnv = (environ: Environ, name: string): string | undefined =>
  Object.hasOwn(environ, name) ? environ[name] : undefined;

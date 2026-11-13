/**
 * @file What `ork ui` and the server it supervises say to each other over the
 *   child's IPC channel (ADR-060). The supervisor that sends `start` may be an
 *   older Ork than the server that reads it (a restart starts the newly
 *   installed `ork`), so these messages only ever gain optional fields. The
 *   token goes this way, never in argv, where `ps` shows it, nor in the
 *   environment, which the runs the server starts would inherit.
 */

/** The child is listening. */
export type HelloMessage = { type: "ork-ui-hello" };

/**
 * What the child serves with: the port, the API token, and the session secret
 * the browser's cookie holds (RFC-019). `session` is optional: a supervisor
 * older than the server sends none, and the server makes its own.
 */
export type StartMessage = {
  type: "ork-ui-start";
  port: number;
  token: string;
  session?: string;
};

/** The child serves, on this port, as this version. */
export type ReadyMessage = {
  type: "ork-ui-ready";
  port: number;
  version: string;
};

/** The child could not serve; it exits next. */
export type FailedMessage = { type: "ork-ui-failed"; error: string };

/** The page asked for a restart; the child closes and exits next. */
export type RestartMessage = { type: "ork-ui-restart" };

export type ChildMessage =
  | HelloMessage
  | ReadyMessage
  | FailedMessage
  | RestartMessage;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const TYPES: ReadonlySet<unknown> = new Set([
  "ork-ui-hello",
  "ork-ui-ready",
  "ork-ui-failed",
  "ork-ui-restart",
]);

/** A message from the child, or `null` for anything else. */
export const childMessage = (value: unknown): ChildMessage | null => {
  if (!isRecord(value) || !TYPES.has(value["type"])) return null;
  const { type, port, version, error } = value;
  if (type === "ork-ui-ready") {
    return typeof port === "number" && typeof version === "string"
      ? { type, port, version }
      : null;
  }
  if (type === "ork-ui-failed") {
    return { type, error: typeof error === "string" ? error : "It failed." };
  }
  return type === "ork-ui-hello" ? { type } : { type: "ork-ui-restart" };
};

/** The supervisor's `start`, or `null` for anything else. */
export const startMessage = (value: unknown): StartMessage | null =>
  isRecord(value) &&
  value["type"] === "ork-ui-start" &&
  typeof value["port"] === "number" &&
  typeof value["token"] === "string"
    ? {
        type: "ork-ui-start",
        port: value["port"],
        token: value["token"],
        ...(typeof value["session"] === "string"
          ? { session: value["session"] }
          : {}),
      }
    : null;

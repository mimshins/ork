/**
 * @file Reads a `model` value that may name its driver: `claude-code.sonnet` is
 *   the `sonnet` model on the `claude-code` driver (RFC-015). One parse, used
 *   by the compiler, the driver fit check, the plan of each `forEach` item and
 *   the Builder.
 */

export type DriverModel = {
  /** The driver the value names; absent for a plain model. */
  driver?: string;
  /**
   * What the tool receives: the text after the driver's dot, else the whole
   * value.
   */
  model: string;
};

/**
 * The text before the first `.` is the driver only when it is one of `drivers`
 * (ids have no dots); the rest goes to the tool as it is. Any other value is a
 * plain model for the run's driver, so `deepseek/deepseek-v4.1-flash` stays
 * plain.
 */
export const driverOf = (
  model: string,
  drivers: readonly string[],
): DriverModel => {
  const dot = model.indexOf(".");
  if (dot <= 0) return { model };
  const id = model.slice(0, dot);
  return drivers.includes(id)
    ? { driver: id, model: model.slice(dot + 1) }
    : { model };
};

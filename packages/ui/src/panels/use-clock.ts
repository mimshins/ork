/**
 * @file The time, kept current while something on screen is counting: a run's
 *   elapsed time and its nodes'. A run that's over holds still.
 */

import { useEffect, useState } from "react";

const TICK_MS = 1000;

export const useClock = (running: boolean): number => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = running
      ? setInterval(() => {
          setNow(Date.now());
        }, TICK_MS)
      : undefined;
    return () => {
      clearInterval(timer);
    };
  }, [running]);
  return now;
};

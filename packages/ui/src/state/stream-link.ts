/**
 * @file A stream that stays connected. A browser's `EventSource` reconnects by
 *   itself after a dropped connection, sending `Last-Event-ID`; but it gives up
 *   for good on any answer other than 200, such as while a server restarts. The
 *   link then opens a new one, with a growing delay and a fresh URL, since a
 *   new `EventSource` cannot send that header. A frame that is not JSON is
 *   dropped: one bad frame must not end a stream.
 */

/** The part of an `EventSource` a link uses: a real one is one. */
export type StreamSource = {
  readonly readyState: number;
  addEventListener: (
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ) => void;
  close: () => void;
};

export type OpenSource = (url: string) => StreamSource;

export const openEventSource: OpenSource = url => new EventSource(url);

export type LinkStatus = "connecting" | "open" | "lost";

export type StreamLink = { close: () => void };

export type LinkOptions<Events> = {
  /** Read at each connection, so a new one starts after what has been seen. */
  url: () => string;
  open: OpenSource;
  /** What to do with each named event of the stream. */
  on: { [Name in keyof Events]: (data: Events[Name]) => void };
  onStatus: (status: LinkStatus) => void;
  /** After every failed attempt: the reason may have changed, the status not. */
  onFailure?: () => void;
};

/** `EventSource.CLOSED`: it will not try again by itself. */
const GAVE_UP = 2;
const RETRY_FIRST_MS = 1000;
const RETRY_MOST_MS = 15_000;

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export const openLink = <Events extends object>({
  url,
  open,
  on,
  onStatus,
  onFailure,
}: LinkOptions<Events>): StreamLink => {
  let source: StreamSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = RETRY_FIRST_MS;
  let status: LinkStatus | null = null;

  const report = (next: LinkStatus): void => {
    if (next !== status) {
      status = next;
      onStatus(next);
    }
  };

  const connect = (): void => {
    const next = open(url());
    source = next;
    next.addEventListener("open", () => {
      delay = RETRY_FIRST_MS;
      report("open");
    });
    next.addEventListener("error", () => {
      report("lost");
      onFailure?.();
      if (next.readyState === GAVE_UP) {
        next.close();
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, RETRY_MOST_MS);
      }
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each handler takes its event's type, per the server's contract
    const handlers = Object.entries(on) as [string, (data: unknown) => void][];
    for (const [name, handle] of handlers) {
      next.addEventListener(name, event => {
        const data = parsed(event.data);
        if (data !== undefined) handle(data);
      });
    }
  };

  report("connecting");
  connect();

  return {
    close: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      source?.close();
      source = null;
    },
  };
};

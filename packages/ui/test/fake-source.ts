/**
 * @file An `EventSource` a test drives: it opens, drops, is refused and sends
 *   frames when the test says, and each one made is listed.
 */

import { vi } from "vitest";

import type { OpenSource, StreamSource } from "../src/state/stream-link.ts";

type FrameListener = (event: MessageEvent<string>) => void;

/** An `EventSource` that does what a test says. */
export class FakeSource implements StreamSource {
  /** Where each new one is listed. */
  static created: FakeSource[] = [];

  readonly url: string;
  readyState = 0;
  closed = false;
  readonly #listeners = new Map<string, FrameListener[]>();

  constructor(url: string) {
    this.url = url;
    FakeSource.created.push(this);
  }

  addEventListener = (type: string, listener: FrameListener): void => {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  };

  close = (): void => {
    this.closed = true;
    this.readyState = 2;
  };

  #fire = (type: string, data = ""): void => {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  };

  /** The server answered. */
  connected = (): void => {
    this.readyState = 1;
    this.#fire("open");
  };

  /** A named event, with this as its data. */
  send = (type: string, data: unknown): void => {
    this.#fire(type, JSON.stringify(data));
  };

  /** A named event, with this text as its data. */
  sendText = (type: string, text: string): void => {
    this.#fire(type, text);
  };

  /** The connection dropped; the browser will try again by itself. */
  dropped = (): void => {
    this.readyState = 0;
    this.#fire("error");
  };

  /** The server refused it, and the browser gave up. */
  refused = (): void => {
    this.readyState = 2;
    this.#fire("error");
  };
}

export type FakeSources = {
  open: OpenSource;
  all: FakeSource[];
  /** The newest one. */
  last: () => FakeSource;
};

export const openFakeSources = (): FakeSources => {
  const all: FakeSource[] = [];
  FakeSource.created = all;
  return {
    all,
    open: url => new FakeSource(url),
    last: () => {
      const source = all.at(-1);
      if (source === undefined) throw new Error("No stream was opened.");
      return source;
    },
  };
};

/** `new EventSource(url)` for what opens one itself: the whole app. */
export const stubEventSource = (): FakeSources => {
  vi.stubGlobal("EventSource", FakeSource);
  return openFakeSources();
};

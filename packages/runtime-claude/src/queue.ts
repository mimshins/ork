/** An async queue: producers `push`, one consumer iterates until `close`. */
export type Queue<T> = AsyncIterable<T> & {
  push: (item: T) => void;
  close: () => void;
  readonly closed: boolean;
};

export const createQueue = <T>(): Queue<T> => {
  // Items are boxed so an item that is itself `undefined` is still an item.
  const items: { value: T }[] = [];
  const waiting: ((result: IteratorResult<T>) => void)[] = [];
  let closed = false;

  const push = (item: T) => {
    if (closed) return;
    const next = waiting.shift();
    if (next === undefined) items.push({ value: item });
    else next({ value: item, done: false });
  };

  const close = () => {
    closed = true;
    for (const next of waiting.splice(0)) {
      next({ value: undefined, done: true });
    }
  };

  const iterator: AsyncIterator<T> = {
    next: () => {
      const box = items.shift();
      if (box !== undefined) {
        return Promise.resolve({ value: box.value, done: false });
      }
      if (closed) return Promise.resolve({ value: undefined, done: true });
      return new Promise(resolve => {
        waiting.push(resolve);
      });
    },
  };

  return {
    push,
    close,
    get closed() {
      return closed;
    },
    [Symbol.asyncIterator]: () => iterator,
  };
};

/**
 * @file Where a browser remembers things. Its storage may be off limits, as in
 *   a private window; what is saved then lasts only as long as the page.
 */

const memoryStorage = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    getItem: key => items.get(key) ?? null,
    key: index => [...items.keys()][index] ?? null,
    removeItem: key => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
};

export const browserStorage = (): Storage => {
  try {
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
};

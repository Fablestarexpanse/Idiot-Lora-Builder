import "@testing-library/jest-dom";

// Node >= 24 defines a `localStorage` global that is undefined unless the
// process was started with --localstorage-file. Vitest's jsdom environment
// skips any key that already exists on globalThis, so jsdom's own working
// localStorage never lands and `zustand/middleware`'s persist blows up with
// "Cannot read properties of undefined (reading 'setItem')" the first time a
// test writes to a persisted store. Give the suite a real in-memory one.
if (!globalThis.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } satisfies Storage,
  });
}

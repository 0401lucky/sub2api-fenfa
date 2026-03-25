import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

const localStorageState = new Map<string, string>();

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    clear() {
      localStorageState.clear();
    },
    getItem(key: string) {
      return localStorageState.has(key) ? localStorageState.get(key)! : null;
    },
    key(index: number) {
      return Array.from(localStorageState.keys())[index] ?? null;
    },
    get length() {
      return localStorageState.size;
    },
    removeItem(key: string) {
      localStorageState.delete(key);
    },
    setItem(key: string, value: string) {
      localStorageState.set(key, String(value));
    }
  } satisfies Storage
});

afterEach(() => {
  window.localStorage.clear();
  cleanup();
});

export const SESSION_TOKEN_STORAGE_KEY = 'welfare.session_token';

interface SessionTokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isSessionTokenStorage(value: unknown): value is SessionTokenStorage {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as SessionTokenStorage).getItem === 'function' &&
    typeof (value as SessionTokenStorage).setItem === 'function' &&
    typeof (value as SessionTokenStorage).removeItem === 'function'
  );
}

function getStorage(): SessionTokenStorage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return isSessionTokenStorage(window.localStorage)
      ? window.localStorage
      : null;
  } catch {
    return null;
  }
}

export function getStoredSessionToken(): string | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  const token = storage.getItem(SESSION_TOKEN_STORAGE_KEY);
  return token && token.trim() !== '' ? token : null;
}

export function storeSessionToken(token: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
}

export function clearStoredSessionToken(): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.removeItem(SESSION_TOKEN_STORAGE_KEY);
}

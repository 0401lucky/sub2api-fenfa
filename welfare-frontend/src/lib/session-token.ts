export const SESSION_TOKEN_STORAGE_KEY = 'welfare.session_token';

function getStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
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

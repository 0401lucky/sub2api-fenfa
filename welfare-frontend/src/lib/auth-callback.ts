export const AUTH_CALLBACK_STORAGE_KEY = 'welfare.auth_callback';

export interface AuthCallbackParams {
  handoff?: string;
  redirect?: string;
  error?: string;
  detail?: string;
}

interface AuthCallbackCaptureResult {
  params: AuthCallbackParams;
  shouldClearUrl: boolean;
}

interface StringStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const handoffExchangeCache = new Map<
  string,
  Promise<{
    session_token: string;
    redirect: string;
  }>
>();

function isStringStorageLike(value: unknown): value is StringStorageLike {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as StringStorageLike).getItem === 'function' &&
      typeof (value as StringStorageLike).setItem === 'function' &&
      typeof (value as StringStorageLike).removeItem === 'function'
  );
}

function getStorage(): StringStorageLike | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return isStringStorageLike(window.sessionStorage)
      ? window.sessionStorage
      : null;
  } catch {
    return null;
  }
}

function parseParams(...inputs: string[]): AuthCallbackParams {
  const out: AuthCallbackParams = {};

  for (const input of inputs) {
    const normalized = input.startsWith('#') || input.startsWith('?')
      ? input.slice(1)
      : input;
    const params = new URLSearchParams(normalized);
    params.forEach((value, key) => {
      if (key === 'handoff' || key === 'redirect' || key === 'error' || key === 'detail') {
        out[key] = value;
      }
    });
  }

  return out;
}

function hasCallbackPayload(params: AuthCallbackParams): boolean {
  return Boolean(params.handoff || params.error || params.detail || params.redirect);
}

function readStoredParams(): AuthCallbackParams {
  const storage = getStorage();
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(AUTH_CALLBACK_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw) as AuthCallbackParams;
  } catch {
    return {};
  }
}

function writeStoredParams(params: AuthCallbackParams): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(AUTH_CALLBACK_STORAGE_KEY, JSON.stringify(params));
}

export function clearAuthCallbackParams(): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.removeItem(AUTH_CALLBACK_STORAGE_KEY);
}

export function captureAuthCallbackParams(
  search: string,
  hash: string
): AuthCallbackCaptureResult {
  const current = parseParams(hash, search);
  if (hasCallbackPayload(current)) {
    writeStoredParams(current);
    return {
      params: current,
      shouldClearUrl: true
    };
  }

  return {
    params: readStoredParams(),
    shouldClearUrl: false
  };
}

export function exchangeSessionHandoffOnce(
  handoff: string,
  exchange: (handoff: string) => Promise<{ session_token: string; redirect: string }>
): Promise<{ session_token: string; redirect: string }> {
  const cached = handoffExchangeCache.get(handoff);
  if (cached) {
    return cached;
  }

  const promise = exchange(handoff).finally(() => {
    handoffExchangeCache.delete(handoff);
  });
  handoffExchangeCache.set(handoff, promise);
  return promise;
}

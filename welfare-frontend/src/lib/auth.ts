import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import type { SessionUser } from '../types';
import { api, isUnauthorizedError } from './api';
import {
  clearStoredSessionToken,
  getStoredSessionToken,
  SESSION_TOKEN_STORAGE_KEY
} from './session-token';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  error: string | null;
  refresh: () => Promise<SessionUser | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  return '服务暂时不可用，请稍后重试';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshPromiseRef = useRef<Promise<SessionUser | null> | null>(null);
  const refreshTokenRef = useRef<string | null>(null);
  const refreshRequestIdRef = useRef(0);

  const refresh = useCallback(async (): Promise<SessionUser | null> => {
    function getLatestRefreshResult(
      fallback: SessionUser | null
    ): Promise<SessionUser | null> {
      return refreshPromiseRef.current ?? Promise.resolve(fallback);
    }

    function startRefresh(): Promise<SessionUser | null> {
      const requestId = refreshRequestIdRef.current + 1;
      const requestToken = getStoredSessionToken();

      refreshRequestIdRef.current = requestId;
      refreshTokenRef.current = requestToken;
      setError(null);
      setStatus((current) => (current === 'authenticated' ? current : 'loading'));

      refreshPromiseRef.current = (async () => {
        try {
          const currentUser = await api.getMe();
          if (refreshRequestIdRef.current !== requestId) {
            return await getLatestRefreshResult(currentUser);
          }

          setUser(currentUser);
          setError(null);
          setStatus('authenticated');
          return currentUser;
        } catch (error) {
          if (refreshRequestIdRef.current !== requestId) {
            return await getLatestRefreshResult(null);
          }

          if (isUnauthorizedError(error)) {
            const latestToken = getStoredSessionToken();
            if (latestToken && latestToken !== requestToken) {
              return await startRefresh();
            }

            if (requestToken) {
              clearStoredSessionToken();
            }
            setUser(null);
            setError(null);
            setStatus('unauthenticated');
            return null;
          }
          setUser(null);
          setError(toErrorMessage(error));
          setStatus('error');
          throw error;
        } finally {
          if (refreshRequestIdRef.current === requestId) {
            refreshPromiseRef.current = null;
            refreshTokenRef.current = null;
          }
        }
      })();

      return refreshPromiseRef.current;
    }

    const latestToken = getStoredSessionToken();
    if (refreshPromiseRef.current && refreshTokenRef.current === latestToken) {
      return await refreshPromiseRef.current;
    }

    return await startRefresh();
  }, []);

  const logout = useCallback(async () => {
    clearStoredSessionToken();
    try {
      await api.logout();
    } catch {
      // 无论后端退出接口是否成功，都以本地会话状态为准。
    }
    setUser(null);
    setError(null);
    setStatus('unauthenticated');
  }, []);

  useEffect(() => {
    void refresh().catch((error) => {
      console.error('[auth] 刷新会话失败', error);
    });
  }, [refresh]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== SESSION_TOKEN_STORAGE_KEY) {
        return;
      }

      void refresh().catch((error) => {
        console.error('[auth] 同步跨标签页会话失败', error);
      });
    }

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      error,
      refresh,
      logout
    }),
    [error, logout, refresh, status, user]
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth 必须在 AuthProvider 内部使用');
  }
  return value;
}

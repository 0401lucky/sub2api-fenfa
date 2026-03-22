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

  const refresh = useCallback(async (): Promise<SessionUser | null> => {
    if (!refreshPromiseRef.current) {
      setError(null);
      setStatus((current) => (current === 'authenticated' ? current : 'loading'));

      refreshPromiseRef.current = (async () => {
        try {
          const currentUser = await api.getMe();
          setUser(currentUser);
          setError(null);
          setStatus('authenticated');
          return currentUser;
        } catch (error) {
          if (isUnauthorizedError(error)) {
            clearStoredSessionToken();
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
          refreshPromiseRef.current = null;
        }
      })();
    }

    return await refreshPromiseRef.current;
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

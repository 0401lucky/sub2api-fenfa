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

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  refresh: () => Promise<SessionUser | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const refreshPromiseRef = useRef<Promise<SessionUser | null> | null>(null);

  const refresh = useCallback(async (): Promise<SessionUser | null> => {
    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = (async () => {
        try {
          const currentUser = await api.getMe();
          setUser(currentUser);
          setStatus('authenticated');
          return currentUser;
        } catch (error) {
          if (isUnauthorizedError(error)) {
            setUser(null);
            setStatus('unauthenticated');
            return null;
          }
          throw error;
        } finally {
          refreshPromiseRef.current = null;
        }
      })();
    }

    try {
      return await refreshPromiseRef.current;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        setUser(null);
        setStatus('unauthenticated');
        return null;
      }
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // 无论后端退出接口是否成功，都以本地会话状态为准。
    }
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  useEffect(() => {
    void refresh().catch((error) => {
      console.error('[auth] 刷新会话失败', error);
      setUser(null);
      setStatus('unauthenticated');
    });
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      refresh,
      logout
    }),
    [logout, refresh, status, user]
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

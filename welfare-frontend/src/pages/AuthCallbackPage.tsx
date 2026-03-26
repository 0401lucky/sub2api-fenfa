import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import {
  captureAuthCallbackParams,
  clearAuthCallbackParams,
  exchangeSessionHandoffOnce
} from '../lib/auth-callback';
import { storeSessionToken } from '../lib/session-token';

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function establishSessionAfterExchange(
  sessionToken: string,
  refresh: () => Promise<unknown>
): Promise<'synced' | 'verified' | 'failed'> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    storeSessionToken(sessionToken);

    try {
      const verifiedUser = await api.getMe(sessionToken);
      if (!verifiedUser) {
        throw new Error('missing user');
      }

      for (let syncAttempt = 0; syncAttempt < 3; syncAttempt += 1) {
        storeSessionToken(sessionToken);
        const syncedUser = await refresh();
        if (syncedUser) {
          return 'synced';
        }

        if (syncAttempt < 2) {
          await wait(120 * (syncAttempt + 1));
        }
      }

      return 'verified';
    } catch {
      if (attempt < 4) {
        await wait(200 * (attempt + 1));
      }
    }
  }

  return 'failed';
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { status, user, error: authError, refresh } = useAuth();
  const [message, setMessage] = useState('正在处理登录回调...');
  const [isError, setIsError] = useState(false);
  const handoffHandledRef = useRef(false);
  const callbackCapture = useMemo(
    () => captureAuthCallbackParams(window.location.search, window.location.hash),
    []
  );
  const handoff = callbackCapture.params.handoff;
  const redirect = callbackCapture.params.redirect || '/checkin';
  const error = callbackCapture.params.error;
  const detail = callbackCapture.params.detail;

  useEffect(() => {
    let cancelled = false;

    if (callbackCapture.shouldClearUrl) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}`
      );
    }

    if (handoff && !handoffHandledRef.current) {
      handoffHandledRef.current = true;
      setIsError(false);
      setMessage('登录成功，正在建立会话...');

      void (async () => {
        try {
          const result = await exchangeSessionHandoffOnce(handoff, api.exchangeSessionHandoff);
          if (cancelled) {
            return;
          }

          storeSessionToken(result.session_token);
          const establishment = await establishSessionAfterExchange(
            result.session_token,
            refresh
          );
          if (cancelled) {
            return;
          }

          if (establishment === 'failed') {
            clearAuthCallbackParams();
            setIsError(true);
            setMessage('登录失败：会话已换取成功，但校验未通过，请重新登录');
            return;
          }

          clearAuthCallbackParams();
          setMessage('登录成功，正在跳转...');
          if (establishment === 'verified') {
            window.location.assign(result.redirect || redirect);
            return;
          }
          navigate(result.redirect || redirect, { replace: true });
        } catch (exchangeError) {
          if (cancelled) {
            return;
          }

          clearAuthCallbackParams();
          setIsError(true);
          setMessage(
            `登录状态校验失败：${
              exchangeError instanceof Error
                ? exchangeError.message
                : '服务暂时不可用，请稍后重试'
            }`
          );
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    if (error) {
      clearAuthCallbackParams();
      setIsError(true);
      setMessage(`登录失败：${detail || error}`);
      const timeout = window.setTimeout(() => {
        navigate('/login', { replace: true });
      }, 1500);
      return () => window.clearTimeout(timeout);
    }

    if (status === 'loading') {
      setIsError(false);
      setMessage('正在处理登录回调...');
      return;
    }

    if (status === 'authenticated' && user) {
      clearAuthCallbackParams();
      setIsError(false);
      setMessage('登录成功，正在跳转...');
      navigate(redirect, { replace: true });
      return;
    }

    if (status === 'error') {
      setIsError(true);
      setMessage(`登录状态校验失败：${authError || '服务暂时不可用，请稍后重试'}`);
      return;
    }

    clearAuthCallbackParams();
    setIsError(true);
    setMessage('登录失败：未建立有效会话');
    const timeout = window.setTimeout(() => {
      navigate('/login', { replace: true });
    }, 1500);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    authError,
    callbackCapture.shouldClearUrl,
    detail,
    error,
    handoff,
    navigate,
    redirect,
    refresh,
    status,
    user
  ]);

  return (
    <div className="page page-center">
      <div className="card auth-card">
        <span className="eyebrow">身份认证</span>
        <h1 className="hero-title">登录回调</h1>
        <p className={isError ? 'alert error' : 'alert success'}>{message}</p>
        {isError && (
          <button
            className="button"
            style={{ marginTop: 12 }}
            onClick={() => {
              clearAuthCallbackParams();
              navigate('/login', { replace: true });
            }}
          >
            返回登录
          </button>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

async function verifySessionToken(sessionToken: string): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    storeSessionToken(sessionToken);

    try {
      const verifiedUser = await api.getMe(sessionToken);
      if (verifiedUser) {
        return true;
      }
    } catch {
      // 忽略单次校验失败，做短重试
    }

    if (attempt < 4) {
      await wait(200 * (attempt + 1));
    }
  }

  return false;
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
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
          const verified = await verifySessionToken(result.session_token);
          if (cancelled) {
            return;
          }

          if (!verified) {
            clearAuthCallbackParams();
            setIsError(true);
            setMessage('登录失败：会话已换取成功，但校验未通过，请重新登录');
            return;
          }

          clearAuthCallbackParams();
          setMessage('登录成功，正在跳转...');
          window.location.replace(result.redirect || redirect);
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

    clearAuthCallbackParams();
    setIsError(true);
    setMessage('登录失败：未建立有效回调参数');
    const timeout = window.setTimeout(() => {
      navigate('/login', { replace: true });
    }, 1500);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [callbackCapture.shouldClearUrl, detail, error, handoff, navigate, redirect]);

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

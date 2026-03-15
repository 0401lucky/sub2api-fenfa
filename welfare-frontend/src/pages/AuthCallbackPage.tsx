import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

function parseParams(...inputs: string[]): Record<string, string> {
  const out: Record<string, string> = {};

  for (const input of inputs) {
    const normalized = input.startsWith('#') || input.startsWith('?')
      ? input.slice(1)
      : input;
    const params = new URLSearchParams(normalized);
    params.forEach((value, key) => {
      out[key] = value;
    });
  }

  return out;
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { status, user } = useAuth();
  const [message, setMessage] = useState('正在处理登录回调...');
  const [isError, setIsError] = useState(false);
  const params = useMemo(
    () => parseParams(window.location.hash, window.location.search),
    []
  );
  const redirect = params.redirect || '/checkin';
  const error = params.error;
  const detail = params.detail;

  useEffect(() => {
    if (error) {
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
      setIsError(false);
      setMessage('登录成功，正在跳转...');
      navigate(redirect, { replace: true });
      return;
    }

    setIsError(true);
    setMessage('登录失败：未建立有效会话');
    const timeout = window.setTimeout(() => {
      navigate('/login', { replace: true });
    }, 1500);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [detail, error, navigate, redirect, status, user]);

  return (
    <div className="page page-center">
      <div className="card auth-card">
        <span className="eyebrow">身份认证</span>
        <h1 className="hero-title">登录回调</h1>
        <p className={isError ? 'alert error' : 'alert success'}>{message}</p>
      </div>
    </div>
  );
}

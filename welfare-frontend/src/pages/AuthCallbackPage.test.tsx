import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthCallbackPage } from './AuthCallbackPage';
import { SESSION_TOKEN_STORAGE_KEY } from '../lib/session-token';

const exchangeSessionHandoffMock = vi.fn();
const getMeMock = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    exchangeSessionHandoff: (...args: unknown[]) => exchangeSessionHandoffMock(...args),
    getMe: (...args: unknown[]) => getMeMock(...args)
  }
}));

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    exchangeSessionHandoffMock.mockReset();
    getMeMock.mockReset();
    getMeMock.mockResolvedValue({
      sub2api_user_id: 1,
      linuxdo_subject: 'subject',
      synthetic_email: 'linuxdo-subject@linuxdo-connect.invalid',
      username: 'tester',
      avatar_url: null,
      is_admin: false
    });
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/auth/callback#handoff=handoff-token&redirect=%2Fcheckin');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('会使用 handoff 建立前端 session token 并跳转到目标页', async () => {
    exchangeSessionHandoffMock.mockResolvedValue({
      session_token: 'session-token',
      redirect: '/checkin'
    });

    render(
      <MemoryRouter
        initialEntries={['/auth/callback']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/checkin" element={<div>签到页</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(exchangeSessionHandoffMock).toHaveBeenCalledWith('handoff-token');
    });
    await waitFor(() => {
      expect(getMeMock).toHaveBeenCalledWith('session-token');
    });
    await waitFor(() => {
      expect(screen.getByText('登录成功，正在跳转...')).toBeInTheDocument();
    });

    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe('session-token');
    expect(window.location.hash).toBe('');
  });

  it('在回调页被重新挂载时也只会交换一次 handoff 并完成登录', async () => {
    exchangeSessionHandoffMock.mockImplementation(
      async () =>
        await new Promise<{ session_token: string; redirect: string }>((resolve) => {
          setTimeout(() => {
            resolve({
              session_token: 'session-token',
              redirect: '/checkin'
            });
          }, 0);
        })
    );

    const firstRender = render(
      <MemoryRouter
        initialEntries={['/auth/callback']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/checkin" element={<div>签到页</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(window.location.hash).toBe('');
    firstRender.unmount();

    render(
      <MemoryRouter
        initialEntries={['/auth/callback']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/checkin" element={<div>签到页</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('登录成功，正在跳转...')).toBeInTheDocument();
    });

    expect(exchangeSessionHandoffMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe('session-token');
  });

  it('会在首次直接校验 token 失败时自动重试', async () => {
    getMeMock
      .mockRejectedValueOnce(new Error('temporary 401'))
      .mockResolvedValueOnce({
        sub2api_user_id: 1,
        linuxdo_subject: 'subject',
        synthetic_email: 'linuxdo-subject@linuxdo-connect.invalid',
        username: 'tester',
        avatar_url: null,
        is_admin: false
      });
    exchangeSessionHandoffMock.mockResolvedValue({
      session_token: 'session-token',
      redirect: '/checkin'
    });

    render(
      <MemoryRouter
        initialEntries={['/auth/callback']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/checkin" element={<div>签到页</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('登录成功，正在跳转...')).toBeInTheDocument();
    });

    expect(getMeMock).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe('session-token');
  });
});

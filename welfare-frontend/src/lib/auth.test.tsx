import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './auth';
import { SESSION_TOKEN_STORAGE_KEY } from './session-token';

const getMeMock = vi.fn();
const logoutMock = vi.fn();

vi.mock('./api', () => ({
  api: {
    getMe: (...args: unknown[]) => getMeMock(...args),
    logout: (...args: unknown[]) => logoutMock(...args)
  },
  isUnauthorizedError: (error: unknown) =>
    Boolean((error as { status?: number } | null)?.status === 401)
}));

function AuthProbe() {
  const { status, error, refresh, user } = useAuth();

  return (
    <div>
      <div data-testid="auth-state">
        {status}|{error ?? '-'}|{user?.linuxdo_subject ?? '-'}
      </div>
      <button onClick={() => void refresh()}>refresh</button>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    getMeMock.mockReset();
    logoutMock.mockReset();
    window.localStorage.clear();
  });

  it('把非 401 的会话恢复异常保留为明确错误态', async () => {
    getMeMock.mockRejectedValue(new Error('backend down'));

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-state')).toHaveTextContent('error|backend down|-');
    });
  });

  it('会在 401 时清理前端保存的 session token', async () => {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'stale-token');
    getMeMock.mockRejectedValue({
      status: 401
    });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-state')).toHaveTextContent('unauthenticated|-|-');
    });
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('会忽略旧 token 的 401，并使用最新 token 完成会话恢复', async () => {
    let rejectFirstRequest: ((reason?: unknown) => void) | undefined;

    getMeMock
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirstRequest = reject;
          })
      )
      .mockResolvedValueOnce({
        sub2api_user_id: 1,
        linuxdo_subject: 'fresh-user',
        synthetic_email: 'fresh-user@linuxdo-connect.invalid',
        username: 'fresh-user',
        avatar_url: null,
        is_admin: false
      });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(getMeMock).toHaveBeenCalledTimes(1);
    });

    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'fresh-token');
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));

    await waitFor(() => {
      expect(getMeMock).toHaveBeenCalledTimes(2);
    });

    if (!rejectFirstRequest) {
      throw new Error('首个请求未正确进入挂起状态');
    }
    rejectFirstRequest({ status: 401 });

    await waitFor(() => {
      expect(screen.getByTestId('auth-state')).toHaveTextContent(
        'authenticated|-|fresh-user'
      );
    });
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe('fresh-token');
  });
});

import { render, screen, waitFor } from '@testing-library/react';
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
  const { status, error } = useAuth();

  return (
    <div>
      {status}|{error ?? '-'}
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
      expect(screen.getByText('error|backend down')).toBeInTheDocument();
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
      expect(screen.getByText('unauthenticated|-')).toBeInTheDocument();
    });
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  });
});

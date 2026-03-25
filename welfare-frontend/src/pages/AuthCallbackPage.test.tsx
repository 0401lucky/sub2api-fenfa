import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthCallbackPage } from './AuthCallbackPage';
import { SESSION_TOKEN_STORAGE_KEY } from '../lib/session-token';

const refreshMock = vi.fn();
const exchangeSessionHandoffMock = vi.fn();
const mockUseAuth = vi.fn();

vi.mock('../lib/auth', () => ({
  useAuth: () => mockUseAuth()
}));

vi.mock('../lib/api', () => ({
  api: {
    exchangeSessionHandoff: (...args: unknown[]) => exchangeSessionHandoffMock(...args)
  }
}));

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    exchangeSessionHandoffMock.mockReset();
    mockUseAuth.mockReset();
    window.localStorage.clear();
    window.history.replaceState({}, '', '/auth/callback#handoff=handoff-token&redirect=%2Fcheckin');
  });

  it('会使用 handoff 建立前端 session token 并跳转到目标页', async () => {
    refreshMock.mockResolvedValue({
      sub2api_user_id: 1
    });
    exchangeSessionHandoffMock.mockResolvedValue({
      session_token: 'session-token',
      redirect: '/checkin'
    });
    mockUseAuth.mockReturnValue({
      status: 'loading',
      user: null,
      error: null,
      refresh: refreshMock,
      logout: vi.fn()
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
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText('签到页')).toBeInTheDocument();
    });

    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe('session-token');
    expect(window.location.hash).toBe('');
  });
});

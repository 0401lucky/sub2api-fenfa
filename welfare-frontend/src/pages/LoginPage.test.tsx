import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

const mockUseAuth = vi.fn();

vi.mock('../lib/auth', () => ({
  useAuth: () => mockUseAuth()
}));

describe('LoginPage', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it('登录入口会保留原始目标页', () => {
    mockUseAuth.mockReturnValue({
      status: 'unauthenticated',
      user: null,
      error: null,
      refresh: vi.fn(),
      logout: vi.fn()
    });

    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/login', state: { from: '/admin' } }]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>
    );

    const expectedHref = `${window.location.origin}/api/auth/linuxdo/start?redirect=%2Fadmin`;
    expect(screen.getByRole('link', { name: /使用 linuxdo 登录/i })).toHaveAttribute(
      'href',
      expectedHref
    );
  });

  it('已登录时优先回到来源页', async () => {
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      user: {
        sub2api_user_id: 1,
        linuxdo_subject: 'subject',
        synthetic_email: 'linuxdo-subject@linuxdo-connect.invalid',
        username: 'tester',
        avatar_url: null,
        is_admin: true
      },
      error: null,
      refresh: vi.fn(),
      logout: vi.fn()
    });

    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/login', state: { from: '/admin' } }]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin" element={<div>管理员目标页</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('管理员目标页')).toBeInTheDocument();
  });
});

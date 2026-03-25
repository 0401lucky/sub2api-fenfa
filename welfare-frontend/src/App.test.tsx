import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const mockUseAuth = vi.fn();

vi.mock('./lib/auth', () => ({
  useAuth: () => mockUseAuth()
}));

vi.mock('./pages/LoginPage', () => ({
  LoginPage: () => <div>登录页</div>
}));

vi.mock('./pages/AuthCallbackPage', () => ({
  AuthCallbackPage: () => <div>回调页</div>
}));

vi.mock('./pages/CheckinPage', () => ({
  CheckinPage: () => <div>签到页</div>
}));

vi.mock('./pages/AdminPage', () => ({
  AdminPage: () => <div>管理页</div>
}));

describe('App routes', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it('非管理员访问 /admin 时会被前端守卫拦回签到页', async () => {
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      user: { is_admin: false },
      error: null,
      refresh: vi.fn(),
      logout: vi.fn()
    });

    render(
      <MemoryRouter
        initialEntries={['/admin']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('签到页')).toBeInTheDocument();
    expect(screen.queryByText('管理页')).not.toBeInTheDocument();
  });

  it('会话校验异常时展示错误态而不是跳回登录页', () => {
    mockUseAuth.mockReturnValue({
      status: 'error',
      user: null,
      error: 'backend down',
      refresh: vi.fn(),
      logout: vi.fn()
    });

    render(
      <MemoryRouter
        initialEntries={['/checkin']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText('会话校验失败')).toBeInTheDocument();
    expect(screen.getByText('backend down')).toBeInTheDocument();
  });
});

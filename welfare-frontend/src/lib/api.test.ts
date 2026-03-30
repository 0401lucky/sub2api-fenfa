import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStoredSessionToken, storeSessionToken } from './session-token';

describe('api request', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.resetModules();
    vi.stubGlobal('fetch', fetchMock);
    vi.unstubAllEnvs();
    clearStoredSessionToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    clearStoredSessionToken();
  });

  it('在本地存在 session token 时自动附带 Authorization 头', async () => {
    storeSessionToken('session-token');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        code: 0,
        message: 'success',
        data: {
          sub2api_user_id: 1,
          email: 'linuxdo-subject@linuxdo-connect.invalid',
          linuxdo_subject: 'subject',
          username: 'tester',
          avatar_url: null,
          is_admin: false
        }
      })
    });

    const { api } = await import('./api');
    await api.getMe();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer session-token');
    expect(init.credentials).toBeUndefined();
  });

  it('构建 LinuxDo 登录地址时会保留后端 base path', async () => {
    vi.stubEnv('VITE_WELFARE_API_BASE', 'https://example.com/welfare-backend');

    const { buildLinuxDoStartUrl } = await import('./api');

    expect(buildLinuxDoStartUrl('/admin')).toBe(
      'https://example.com/welfare-backend/api/auth/linuxdo/start?redirect=%2Fadmin'
    );
  });

  it('构建 LinuxDo 登录地址时兼容相对路径 base', async () => {
    vi.stubEnv('VITE_WELFARE_API_BASE', '/welfare-backend');

    const { buildLinuxDoStartUrl } = await import('./api');

    expect(buildLinuxDoStartUrl('/admin')).toBe(
      `${window.location.origin}/welfare-backend/api/auth/linuxdo/start?redirect=%2Fadmin`
    );
  });

  it('构建 sub2api 管理员登录地址时会附带后台跳转目标', async () => {
    vi.stubEnv('VITE_SUB2API_ADMIN_LOGIN_URL', 'https://sub2api.example.com/admin-login');

    const { buildSub2apiAdminLoginUrl } = await import('./api');

    expect(buildSub2apiAdminLoginUrl('/admin')).toBe(
      'https://sub2api.example.com/admin-login?redirect=%2Fadmin'
    );
  });
});

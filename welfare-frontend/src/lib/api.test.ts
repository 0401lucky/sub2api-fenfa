import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { clearStoredSessionToken, storeSessionToken } from './session-token';

describe('api request', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    clearStoredSessionToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
          linuxdo_subject: 'subject',
          synthetic_email: 'linuxdo-subject@linuxdo-connect.invalid',
          username: 'tester',
          avatar_url: null,
          is_admin: false
        }
      })
    });

    await api.getMe();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer session-token');
    expect(init.credentials).toBe('include');
  });
});

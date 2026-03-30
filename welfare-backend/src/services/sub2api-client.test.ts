import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/test';
process.env.WELFARE_FRONTEND_URL ??= 'http://localhost:5173';
process.env.WELFARE_JWT_SECRET ??= 'test-secret-123456';
process.env.LINUXDO_CLIENT_ID ??= 'test-client-id';
process.env.LINUXDO_CLIENT_SECRET ??= 'test-client-secret';
process.env.LINUXDO_AUTHORIZE_URL ??= 'https://example.com/oauth/authorize';
process.env.LINUXDO_TOKEN_URL ??= 'https://example.com/oauth/token';
process.env.LINUXDO_USERINFO_URL ??= 'https://example.com/oauth/userinfo';
process.env.LINUXDO_REDIRECT_URI ??= 'http://localhost:8787/api/auth/linuxdo/callback';
process.env.SUB2API_BASE_URL ??= 'https://example.com';
process.env.SUB2API_ADMIN_API_KEY ??= 'test-api-key';
process.env.SUB2API_TIMEOUT_MS ??= '1000';

const { Sub2apiClient, Sub2apiResponseError } = await import('./sub2api-client.js');

describe('sub2api client', () => {
  const client = new Sub2apiClient();
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('查询用户遇到 502 时会自动重试', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response('bad gateway', {
          status: 502
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: 'ok',
            data: {
              items: [
                {
                  id: 42,
                  email: 'linuxdo-user@linuxdo-connect.invalid'
                }
              ],
              total: 1
            }
          }),
          {
            status: 200
          }
        )
      );

    const user = await client.findUserBySyntheticEmail(
      'linuxdo-user@linuxdo-connect.invalid'
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(user).toEqual({
      id: 42,
      email: 'linuxdo-user@linuxdo-connect.invalid'
    });
  });

  it('余额发放超时后会带着同一个幂等键重试', async () => {
    fetchMock
      .mockRejectedValueOnce(
        Object.assign(new Error('request timeout'), {
          name: 'AbortError'
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: 'ok',
            data: {
              id: 42,
              email: 'linuxdo-user@linuxdo-connect.invalid',
              balance: 300
            }
          }),
          {
            status: 200,
            headers: {
              'x-request-id': 'req-balance-1'
            }
          }
        )
      );

    const result = await client.addUserBalance({
      userId: 42,
      amount: 100,
      notes: '福利兑换码 福利100刀兑换',
      idempotencyKey: 'welfare-redeem:3:42'
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'Idempotency-Key': 'welfare-redeem:3:42'
      })
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'Idempotency-Key': 'welfare-redeem:3:42'
      })
    });
    expect(result).toEqual({
      newBalance: 300,
      requestId: 'req-balance-1'
    });
  });

  it('sub2api 返回业务失败时会抛出非重试型错误', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 10001,
          message: 'quota locked'
        }),
        {
          status: 200
        }
      )
    );

    await expect(
      client.addUserBalance({
        userId: 42,
        amount: 100,
        notes: '福利兑换码 福利100刀兑换',
        idempotencyKey: 'welfare-redeem:3:42'
      })
    ).rejects.toBeInstanceOf(Sub2apiResponseError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('删除用户会调用管理员删除接口', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            message: 'deleted'
          }
        }),
        {
          status: 200
        }
      )
    );

    const result = await client.deleteAdminUser(42);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/api/v1/admin/users/42',
      expect.objectContaining({
        method: 'DELETE'
      })
    );
    expect(result).toEqual({ message: 'deleted' });
  });
});

import { describe, expect, it, vi } from 'vitest';

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

const { WelfareRepository } = await import('./welfare-repository.js');

describe('WelfareRepository', () => {
  it('createCheckinPending 会把幂等键作为独立参数写入 SQL', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          id: 1,
          sub2api_user_id: 42,
          sub2api_email: 'user@example.com',
          sub2api_username: 'tester',
          linuxdo_subject: 'linuxdo-42',
          checkin_date: '2026-03-30',
          checkin_mode: 'normal',
          blindbox_item_id: null,
          blindbox_title: '',
          reward_balance: '10',
          idempotency_key: 'welfare-checkin:normal:42:2026-03-30',
          grant_status: 'pending',
          grant_error: '',
          sub2api_request_id: '',
          created_at: '2026-03-30T00:00:00.000Z',
          updated_at: '2026-03-30T00:00:00.000Z'
        }
      ]
    });

    const repository = new WelfareRepository({ query } as never);

    await repository.createCheckinPending({
      sub2apiUserId: 42,
      sub2apiEmail: 'user@example.com',
      sub2apiUsername: 'tester',
      linuxdoSubject: 'linuxdo-42',
      checkinDate: '2026-03-30',
      checkinMode: 'normal',
      blindboxItemId: null,
      blindboxTitle: '',
      rewardBalance: 10,
      idempotencyKey: 'welfare-checkin:normal:42:2026-03-30'
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain(
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')"
    );
    expect(params).toEqual([
      42,
      'user@example.com',
      'tester',
      'linuxdo-42',
      '2026-03-30',
      'normal',
      null,
      '',
      10,
      'welfare-checkin:normal:42:2026-03-30'
    ]);
  });

  it('addAdminWhitelist 在 linuxdo_subject 为空时会走事务查询再插入，不依赖 ON CONFLICT 推断', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 3,
            sub2api_user_id: 99,
            sub2api_email: 'lucky@bluepha.org',
            sub2api_username: 'lucky',
            linuxdo_subject: null,
            notes: 'manual',
            created_at: '2026-03-31T00:00:00.000Z'
          }
        ]
      })
      .mockResolvedValueOnce({});
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({
      query,
      release
    });

    const repository = new WelfareRepository({ connect } as never);

    const result = await repository.addAdminWhitelist({
      sub2apiUserId: 99,
      email: 'lucky@bluepha.org',
      username: 'lucky',
      linuxdoSubject: null,
      notes: 'manual'
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query.mock.calls[2]?.[0]).toContain('INSERT INTO welfare_admin_whitelist');
    expect(query.mock.calls[2]?.[0]).not.toContain('ON CONFLICT (sub2api_user_id)');
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: 3,
      sub2apiUserId: 99,
      email: 'lucky@bluepha.org',
      username: 'lucky',
      linuxdoSubject: null,
      notes: 'manual',
      createdAt: '2026-03-31T00:00:00.000Z'
    });
  });
});

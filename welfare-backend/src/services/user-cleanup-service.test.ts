import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const { UserCleanupService } = await import('./user-cleanup-service.js');

function createRepositoryMock() {
  return {
    listAdminWhitelist: vi.fn(),
    getUserActivitySummaryMap: vi.fn(),
    createUserCleanupLog: vi.fn()
  };
}

function createSub2apiMock() {
  return {
    listAllAdminUsers: vi.fn(),
    getAdminUserById: vi.fn(),
    deleteAdminUser: vi.fn()
  };
}

describe('user cleanup service', () => {
  const repository = createRepositoryMock();
  const sub2api = createSub2apiMock();
  const service = new UserCleanupService(repository as never, sub2api as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('只返回非 LinuxDo、非管理员、无福利站流水的候选用户', async () => {
    sub2api.listAllAdminUsers.mockResolvedValue([
      { id: 1, email: 'current@example.com', username: 'current', balance: 0 },
      { id: 2, email: 'linuxdo-subject@linuxdo-connect.invalid', username: 'linuxdo', balance: 0 },
      { id: 3, email: 'admin@example.com', username: 'admin', balance: 0 },
      { id: 4, email: 'used@example.com', username: 'used', balance: 0 },
      { id: 5, email: 'candidate@example.com', username: 'candidate', balance: 12 }
    ]);
    repository.listAdminWhitelist.mockResolvedValue([
      {
        id: 1,
        sub2apiUserId: 3,
        email: 'admin@example.com',
        username: 'admin',
        linuxdoSubject: null,
        notes: '',
        createdAt: '2026-03-30T00:00:00.000Z'
      }
    ]);
    repository.getUserActivitySummaryMap.mockResolvedValue(
      new Map([
        [1, { sub2apiUserId: 1, checkinCount: 0, redeemCount: 0, resetCount: 0 }],
        [2, { sub2apiUserId: 2, checkinCount: 0, redeemCount: 0, resetCount: 0 }],
        [3, { sub2apiUserId: 3, checkinCount: 0, redeemCount: 0, resetCount: 0 }],
        [4, { sub2apiUserId: 4, checkinCount: 1, redeemCount: 0, resetCount: 0 }],
        [5, { sub2apiUserId: 5, checkinCount: 0, redeemCount: 0, resetCount: 0 }]
      ])
    );

    const result = await service.listCleanupCandidates({
      page: 1,
      pageSize: 20,
      currentUserId: 1
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        sub2api_user_id: 5,
        email: 'candidate@example.com',
        cleanup_reason: '非 LinuxDo / 非管理员 / 无福利站流水'
      })
    );
  });

  it('删除前会重新校验管理员保护和活动记录', async () => {
    repository.listAdminWhitelist.mockResolvedValue([
      {
        id: 1,
        sub2apiUserId: 8,
        email: 'protected@example.com',
        username: 'protected',
        linuxdoSubject: null,
        notes: '',
        createdAt: '2026-03-30T00:00:00.000Z'
      }
    ]);
    repository.getUserActivitySummaryMap.mockResolvedValue(
      new Map([
        [8, { sub2apiUserId: 8, checkinCount: 0, redeemCount: 0, resetCount: 0 }],
        [9, { sub2apiUserId: 9, checkinCount: 1, redeemCount: 0, resetCount: 0 }]
      ])
    );
    sub2api.getAdminUserById
      .mockResolvedValueOnce({
        id: 8,
        email: 'protected@example.com',
        username: 'protected',
        balance: 0
      })
      .mockResolvedValueOnce({
        id: 9,
        email: 'used@example.com',
        username: 'used',
        balance: 0
      });

    const result = await service.deleteCleanupCandidates(
      {
        sub2apiUserId: 7,
        email: 'operator@example.com',
        linuxdoSubject: null,
        username: 'operator',
        avatarUrl: null
      },
      [8, 9]
    );

    expect(result.success_count).toBe(0);
    expect(result.fail_count).toBe(2);
    expect(sub2api.deleteAdminUser).not.toHaveBeenCalled();
    expect(repository.createUserCleanupLog).toHaveBeenCalledTimes(2);
  });

  it('候选用户会被删除并记录成功日志', async () => {
    repository.listAdminWhitelist.mockResolvedValue([]);
    repository.getUserActivitySummaryMap.mockResolvedValue(
      new Map([
        [10, { sub2apiUserId: 10, checkinCount: 0, redeemCount: 0, resetCount: 0 }]
      ])
    );
    sub2api.getAdminUserById.mockResolvedValue({
      id: 10,
      email: 'candidate@example.com',
      username: 'candidate',
      balance: 0
    });
    sub2api.deleteAdminUser.mockResolvedValue({ message: 'ok' });

    const result = await service.deleteCleanupCandidates(
      {
        sub2apiUserId: 7,
        email: 'operator@example.com',
        linuxdoSubject: null,
        username: 'operator',
        avatarUrl: null
      },
      [10]
    );

    expect(result.success_count).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        sub2api_user_id: 10,
        deleted: true
      })
    );
    expect(sub2api.deleteAdminUser).toHaveBeenCalledWith(10);
  });
});

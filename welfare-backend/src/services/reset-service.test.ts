import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResetRecord } from '../types/domain.js';

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

const { mockPoolConnect } = vi.hoisted(() => ({
  mockPoolConnect: vi.fn()
}));

vi.mock('../db.js', () => ({
  pool: {
    connect: mockPoolConnect
  }
}));

const {
  ResetService,
  ConflictError,
  ForbiddenError,
  NotFoundError
} = await import('./reset-service.js');

function createRepositoryMock() {
  return {
    getSettings: vi.fn(),
    getLatestUserResetRecord: vi.fn(),
    getLatestUserSuccessfulReset: vi.fn(),
    listUserResetRecords: vi.fn(),
    createResetPending: vi.fn(),
    markResetSuccess: vi.fn(),
    markResetFailed: vi.fn(),
    queryAdminResetRecords: vi.fn()
  };
}

function createSub2apiMock() {
  return {
    getAdminUserById: vi.fn(),
    addUserBalance: vi.fn()
  };
}

function createSuccessResetRecord(): ResetRecord {
  return {
    id: 1,
    sub2apiUserId: 7,
    sub2apiEmail: 'tester@example.com',
    sub2apiUsername: 'tester',
    linuxdoSubject: 'subject',
    beforeBalance: 12,
    thresholdBalance: 20,
    targetBalance: 200,
    grantedBalance: 188,
    newBalance: 200,
    cooldownDays: 7,
    idempotencyKey: 'welfare-reset:7:1',
    grantStatus: 'success',
    grantError: '',
    sub2apiRequestId: 'req-reset-1',
    createdAt: '2026-03-30T00:00:00.000Z',
    updatedAt: '2026-03-30T00:00:01.000Z'
  };
}

describe('reset service', () => {
  const repository = createRepositoryMock();
  const sub2api = createSub2apiMock();
  const service = new ResetService(repository as never, sub2api as never);
  const client = {
    query: vi.fn(),
    release: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolConnect.mockResolvedValue(client);
    client.query.mockResolvedValue({});
  });

  it('状态接口在满足条件时返回可重置', async () => {
    repository.getSettings.mockResolvedValue({
      checkinEnabled: true,
      blindboxEnabled: true,
      dailyRewardMinBalance: 10,
      dailyRewardMaxBalance: 10,
      timezone: 'Asia/Shanghai',
      resetEnabled: true,
      resetThresholdBalance: 20,
      resetTargetBalance: 200,
      resetCooldownDays: 7,
      resetNotice: '余额低于阈值时可直接重置'
    });
    repository.getLatestUserResetRecord.mockResolvedValue(null);
    repository.getLatestUserSuccessfulReset.mockResolvedValue(null);
    sub2api.getAdminUserById.mockResolvedValue({
      id: 7,
      email: 'tester@example.com',
      username: 'tester',
      balance: 12
    });

    const result = await service.getStatus({
      sub2apiUserId: 7,
      email: 'tester@example.com',
      linuxdoSubject: 'subject',
      username: 'tester',
      avatarUrl: null
    });

    expect(result.can_apply).toBe(true);
    expect(result.current_balance).toBe(12);
    expect(result.threshold_balance).toBe(20);
    expect(result.target_balance).toBe(200);
  });

  it('重置成功时会按差额补齐到目标值', async () => {
    repository.getSettings.mockResolvedValue({
      checkinEnabled: true,
      blindboxEnabled: true,
      dailyRewardMinBalance: 10,
      dailyRewardMaxBalance: 10,
      timezone: 'Asia/Shanghai',
      resetEnabled: true,
      resetThresholdBalance: 20,
      resetTargetBalance: 200,
      resetCooldownDays: 7,
      resetNotice: '余额低于阈值时可直接重置'
    });
    repository.getLatestUserSuccessfulReset.mockResolvedValue(null);
    repository.createResetPending.mockResolvedValue({
      ...createSuccessResetRecord(),
      grantStatus: 'pending',
      newBalance: null,
      sub2apiRequestId: '',
      createdAt: '2026-03-30T08:00:00.000Z',
      updatedAt: '2026-03-30T08:00:00.000Z'
    });
    sub2api.getAdminUserById.mockResolvedValue({
      id: 7,
      email: 'tester@example.com',
      username: 'tester',
      balance: 12
    });
    sub2api.addUserBalance.mockResolvedValue({
      newBalance: 200,
      requestId: 'req-reset-1'
    });

    const result = await service.apply({
      sub2apiUserId: 7,
      email: 'tester@example.com',
      linuxdoSubject: 'subject',
      username: 'tester',
      avatarUrl: null
    });

    expect(sub2api.addUserBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        amount: 188,
        notes: '福利额度重置 12 -> 200'
      })
    );
    expect(repository.markResetSuccess).toHaveBeenCalledWith(
      1,
      'req-reset-1',
      200,
      client
    );
    expect(result).toEqual(
      expect.objectContaining({
        before_balance: 12,
        granted_balance: 188,
        new_balance: 200,
        target_balance: 200,
        grant_status: 'success'
      })
    );
  });

  it('重置关闭时抛出 ForbiddenError', async () => {
    repository.getSettings.mockResolvedValue({
      checkinEnabled: true,
      blindboxEnabled: true,
      dailyRewardMinBalance: 10,
      dailyRewardMaxBalance: 10,
      timezone: 'Asia/Shanghai',
      resetEnabled: false,
      resetThresholdBalance: 20,
      resetTargetBalance: 200,
      resetCooldownDays: 7,
      resetNotice: ''
    });

    await expect(
      service.apply({
        sub2apiUserId: 7,
        email: 'tester@example.com',
        linuxdoSubject: 'subject',
        username: 'tester',
        avatarUrl: null
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('冷却中时抛出 ConflictError', async () => {
    repository.getSettings.mockResolvedValue({
      checkinEnabled: true,
      blindboxEnabled: true,
      dailyRewardMinBalance: 10,
      dailyRewardMaxBalance: 10,
      timezone: 'Asia/Shanghai',
      resetEnabled: true,
      resetThresholdBalance: 20,
      resetTargetBalance: 200,
      resetCooldownDays: 7,
      resetNotice: ''
    });
    repository.getLatestUserSuccessfulReset.mockResolvedValue({
      ...createSuccessResetRecord(),
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    });

    await expect(
      service.apply({
        sub2apiUserId: 7,
        email: 'tester@example.com',
        linuxdoSubject: 'subject',
        username: 'tester',
        avatarUrl: null
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('上游补差额失败时会回写失败状态', async () => {
    repository.getSettings.mockResolvedValue({
      checkinEnabled: true,
      blindboxEnabled: true,
      dailyRewardMinBalance: 10,
      dailyRewardMaxBalance: 10,
      timezone: 'Asia/Shanghai',
      resetEnabled: true,
      resetThresholdBalance: 20,
      resetTargetBalance: 200,
      resetCooldownDays: 7,
      resetNotice: ''
    });
    repository.getLatestUserSuccessfulReset.mockResolvedValue(null);
    repository.createResetPending.mockResolvedValue({
      ...createSuccessResetRecord(),
      id: 9,
      grantStatus: 'pending',
      newBalance: null,
      sub2apiRequestId: '',
      createdAt: '2026-03-30T08:00:00.000Z',
      updatedAt: '2026-03-30T08:00:00.000Z'
    });
    sub2api.getAdminUserById.mockResolvedValue({
      id: 7,
      email: 'tester@example.com',
      username: 'tester',
      balance: 12
    });
    sub2api.addUserBalance.mockRejectedValue(new Error('quota locked'));

    await expect(
      service.apply({
        sub2apiUserId: 7,
        email: 'tester@example.com',
        linuxdoSubject: 'subject',
        username: 'tester',
        avatarUrl: null
      })
    ).rejects.toThrow('quota locked');

    expect(repository.markResetFailed).toHaveBeenCalledWith(9, 'quota locked', client);
  });

  it('上游查不到用户时抛出 NotFoundError', async () => {
    repository.getSettings.mockResolvedValue({
      checkinEnabled: true,
      blindboxEnabled: true,
      dailyRewardMinBalance: 10,
      dailyRewardMaxBalance: 10,
      timezone: 'Asia/Shanghai',
      resetEnabled: true,
      resetThresholdBalance: 20,
      resetTargetBalance: 200,
      resetCooldownDays: 7,
      resetNotice: ''
    });
    repository.getLatestUserSuccessfulReset.mockResolvedValue(null);
    sub2api.getAdminUserById.mockResolvedValue(null);

    await expect(
      service.apply({
        sub2apiUserId: 7,
        email: 'tester@example.com',
        linuxdoSubject: 'subject',
        username: 'tester',
        avatarUrl: null
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

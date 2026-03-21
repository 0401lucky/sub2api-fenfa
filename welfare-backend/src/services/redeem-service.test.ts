import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RedeemClaim, RedeemCode } from '../types/domain.js';

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

const {
  RedeemService,
  ConflictError,
  ForbiddenError,
  NotFoundError
} = await import('./redeem-service.js');

function createRepositoryMock() {
  return {
    withTransaction: vi.fn(),
    getRedeemCodeByCodeForUpdate: vi.fn(),
    getRedeemCodeById: vi.fn(),
    createRedeemCode: vi.fn(),
    updateRedeemCode: vi.fn(),
    listRedeemCodes: vi.fn(),
    getRedeemClaimById: vi.fn(),
    getRedeemClaimByIdForUpdate: vi.fn(),
    getRedeemClaimByCodeAndUser: vi.fn(),
    createRedeemClaimPending: vi.fn(),
    incrementRedeemCodeClaimedCount: vi.fn(),
    markRedeemClaimPendingRetry: vi.fn(),
    claimStaleRedeemPending: vi.fn(),
    markRedeemClaimSuccess: vi.fn(),
    markRedeemClaimFailed: vi.fn(),
    listUserRedeemClaims: vi.fn(),
    queryAdminRedeemClaims: vi.fn()
  };
}

function createSub2apiMock() {
  return {
    addUserBalance: vi.fn()
  };
}

function createRedeemCode(): RedeemCode {
  return {
    id: 3,
    code: 'WELFARE100',
    title: '福利100刀兑换',
    rewardBalance: 100,
    maxClaims: 10,
    claimedCount: 4,
    enabled: true,
    expiresAt: null,
    notes: '',
    createdAt: '2026-03-21T10:00:00.000Z',
    updatedAt: '2026-03-21T10:00:00.000Z'
  };
}

function createFailedClaim(): RedeemClaim {
  return {
    id: 9,
    redeemCodeId: 3,
    sub2apiUserId: 42,
    linuxdoSubject: 'linuxdo-user',
    syntheticEmail: 'linuxdo-user@linuxdo-connect.invalid',
    redeemCode: 'WELFARE100',
    redeemTitle: '福利100刀兑换',
    rewardBalance: 100,
    idempotencyKey: 'welfare-redeem:3:42',
    grantStatus: 'failed',
    grantError: 'network timeout',
    sub2apiRequestId: '',
    createdAt: '2026-03-21T10:00:00.000Z',
    updatedAt: '2026-03-21T10:00:00.000Z'
  };
}

describe('redeem service', () => {
  const repository = createRepositoryMock();
  const sub2api = createSub2apiMock();
  const service = new RedeemService(repository, sub2api);

  beforeEach(() => {
    vi.clearAllMocks();
    repository.withTransaction.mockImplementation(async (fn: (tx: object) => Promise<unknown>) =>
      fn({} as object)
    );
  });

  it('新用户成功兑换并占用名额', async () => {
    const code = createRedeemCode();
    const pendingClaim: RedeemClaim = {
      ...createFailedClaim(),
      id: 10,
      grantStatus: 'pending',
      grantError: ''
    };

    repository.getRedeemCodeByCodeForUpdate.mockResolvedValue(code);
    repository.getRedeemClaimByCodeAndUser.mockResolvedValue(null);
    repository.createRedeemClaimPending.mockResolvedValue(pendingClaim);
    repository.incrementRedeemCodeClaimedCount.mockResolvedValue({
      ...code,
      claimedCount: code.claimedCount + 1
    });
    repository.markRedeemClaimSuccess.mockResolvedValue(undefined);
    sub2api.addUserBalance.mockResolvedValue({
      newBalance: 300,
      requestId: 'req-redeem-1'
    });

    const result = await service.redeem(
      {
        sub2apiUserId: 42,
        linuxdoSubject: 'linuxdo-user',
        syntheticEmail: 'linuxdo-user@linuxdo-connect.invalid',
        username: 'tester',
        avatarUrl: null
      },
      ' welfare100 '
    );

    expect(repository.getRedeemCodeByCodeForUpdate).toHaveBeenCalledWith(
      'WELFARE100',
      expect.anything()
    );
    expect(repository.createRedeemClaimPending).toHaveBeenCalledWith(
      expect.objectContaining({
        redeemCodeId: code.id,
        rewardBalance: code.rewardBalance,
        idempotencyKey: 'welfare-redeem:3:42'
      }),
      expect.anything()
    );
    expect(repository.incrementRedeemCodeClaimedCount).toHaveBeenCalledWith(
      code.id,
      expect.anything()
    );
    expect(sub2api.addUserBalance).toHaveBeenCalledWith({
      userId: 42,
      amount: 100,
      notes: '福利兑换码 福利100刀兑换',
      idempotencyKey: 'welfare-redeem:3:42'
    });
    expect(result).toEqual({
      claim_id: pendingClaim.id,
      code: pendingClaim.redeemCode,
      title: pendingClaim.redeemTitle,
      reward_balance: pendingClaim.rewardBalance,
      new_balance: 300,
      grant_status: 'success'
    });
  });

  it('同一用户重复领取成功记录时抛出冲突', async () => {
    repository.getRedeemCodeByCodeForUpdate.mockResolvedValue(createRedeemCode());
    repository.getRedeemClaimByCodeAndUser.mockResolvedValue({
      ...createFailedClaim(),
      grantStatus: 'success',
      grantError: ''
    } satisfies RedeemClaim);

    await expect(
      service.redeem(
        {
          sub2apiUserId: 42,
          linuxdoSubject: 'linuxdo-user',
          syntheticEmail: 'linuxdo-user@linuxdo-connect.invalid',
          username: 'tester',
          avatarUrl: null
        },
        'WELFARE100'
      )
    ).rejects.toBeInstanceOf(ConflictError);
    expect(repository.createRedeemClaimPending).not.toHaveBeenCalled();
  });

  it('名额已满时阻止新用户领取', async () => {
    repository.getRedeemCodeByCodeForUpdate.mockResolvedValue({
      ...createRedeemCode(),
      claimedCount: 10
    } satisfies RedeemCode);
    repository.getRedeemClaimByCodeAndUser.mockResolvedValue(null);

    await expect(
      service.redeem(
        {
          sub2apiUserId: 43,
          linuxdoSubject: 'linuxdo-user-2',
          syntheticEmail: 'linuxdo-user-2@linuxdo-connect.invalid',
          username: 'tester2',
          avatarUrl: null
        },
        'WELFARE100'
      )
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('兑换码停用时阻止新用户领取', async () => {
    repository.getRedeemCodeByCodeForUpdate.mockResolvedValue({
      ...createRedeemCode(),
      enabled: false
    } satisfies RedeemCode);
    repository.getRedeemClaimByCodeAndUser.mockResolvedValue(null);

    await expect(
      service.redeem(
        {
          sub2apiUserId: 43,
          linuxdoSubject: 'linuxdo-user-2',
          syntheticEmail: 'linuxdo-user-2@linuxdo-connect.invalid',
          username: 'tester2',
          avatarUrl: null
        },
        'WELFARE100'
      )
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('兑换码不存在时抛出 NotFoundError', async () => {
    repository.getRedeemCodeByCodeForUpdate.mockResolvedValue(null);

    await expect(
      service.redeem(
        {
          sub2apiUserId: 43,
          linuxdoSubject: 'linuxdo-user-2',
          syntheticEmail: 'linuxdo-user-2@linuxdo-connect.invalid',
          username: 'tester2',
          avatarUrl: null
        },
        'WELFARE100'
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('失败记录重试时保留原始额度且不重复占用名额', async () => {
    const code = createRedeemCode();
    const failedClaim = createFailedClaim();
    const pendingClaim: RedeemClaim = {
      ...failedClaim,
      grantStatus: 'pending',
      grantError: ''
    };

    repository.getRedeemCodeByCodeForUpdate.mockResolvedValue(code);
    repository.getRedeemClaimByCodeAndUser.mockResolvedValue(failedClaim);
    repository.markRedeemClaimPendingRetry.mockResolvedValue(pendingClaim);
    repository.markRedeemClaimSuccess.mockResolvedValue(undefined);
    sub2api.addUserBalance.mockResolvedValue({
      newBalance: 301,
      requestId: 'req-retry'
    });

    const result = await service.redeem(
      {
        sub2apiUserId: 42,
        linuxdoSubject: 'linuxdo-user',
        syntheticEmail: 'linuxdo-user@linuxdo-connect.invalid',
        username: 'tester',
        avatarUrl: null
      },
      'WELFARE100'
    );

    expect(repository.markRedeemClaimPendingRetry).toHaveBeenCalledWith(
      failedClaim.id,
      expect.anything()
    );
    expect(repository.incrementRedeemCodeClaimedCount).not.toHaveBeenCalled();
    expect(result.reward_balance).toBe(failedClaim.rewardBalance);
  });

  it('兑换失败时会回写失败状态', async () => {
    const pendingClaim: RedeemClaim = {
      ...createFailedClaim(),
      grantStatus: 'pending',
      grantError: ''
    };

    repository.getRedeemCodeByCodeForUpdate.mockResolvedValue(createRedeemCode());
    repository.getRedeemClaimByCodeAndUser.mockResolvedValue(null);
    repository.createRedeemClaimPending.mockResolvedValue(pendingClaim);
    repository.incrementRedeemCodeClaimedCount.mockResolvedValue(createRedeemCode());
    repository.markRedeemClaimFailed.mockResolvedValue(undefined);
    sub2api.addUserBalance.mockRejectedValue(new Error('upstream unavailable'));

    await expect(
      service.redeem(
        {
          sub2apiUserId: 42,
          linuxdoSubject: 'linuxdo-user',
          syntheticEmail: 'linuxdo-user@linuxdo-connect.invalid',
          username: 'tester',
          avatarUrl: null
        },
        'WELFARE100'
      )
    ).rejects.toThrow('upstream unavailable');
    expect(repository.markRedeemClaimFailed).toHaveBeenCalledWith(
      pendingClaim.id,
      'upstream unavailable'
    );
  });

  it('用户重复提交时会接管超时 pending 记录', async () => {
    const stalePending: RedeemClaim = {
      ...createFailedClaim(),
      grantStatus: 'pending',
      grantError: '',
      updatedAt: '2026-03-21T10:00:00.000Z'
    };
    const recoveredPending: RedeemClaim = {
      ...stalePending,
      updatedAt: '2026-03-21T10:01:00.000Z'
    };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T10:01:00.000Z'));

    repository.getRedeemCodeByCodeForUpdate.mockResolvedValue(createRedeemCode());
    repository.getRedeemClaimByCodeAndUser.mockResolvedValue(stalePending);
    repository.claimStaleRedeemPending.mockResolvedValue(recoveredPending);
    repository.markRedeemClaimSuccess.mockResolvedValue(undefined);
    sub2api.addUserBalance.mockResolvedValue({
      newBalance: 400,
      requestId: 'req-pending'
    });

    const result = await service.redeem(
      {
        sub2apiUserId: 42,
        linuxdoSubject: 'linuxdo-user',
        syntheticEmail: 'linuxdo-user@linuxdo-connect.invalid',
        username: 'tester',
        avatarUrl: null
      },
      'WELFARE100'
    );

    expect(repository.claimStaleRedeemPending).toHaveBeenCalledWith(
      stalePending.id,
      30000,
      expect.anything()
    );
    expect(result.grant_status).toBe('success');

    vi.useRealTimers();
  });

  it('管理员可重试失败兑换记录', async () => {
    const failedClaim = createFailedClaim();
    const pendingClaim: RedeemClaim = {
      ...failedClaim,
      grantStatus: 'pending',
      grantError: ''
    };
    const successClaim: RedeemClaim = {
      ...failedClaim,
      grantStatus: 'success',
      grantError: '',
      sub2apiRequestId: 'req-admin-retry'
    };

    repository.getRedeemClaimByIdForUpdate.mockResolvedValue(failedClaim);
    repository.markRedeemClaimPendingRetry.mockResolvedValue(pendingClaim);
    repository.markRedeemClaimSuccess.mockResolvedValue(undefined);
    repository.getRedeemClaimById.mockResolvedValue(successClaim);
    sub2api.addUserBalance.mockResolvedValue({
      newBalance: 456,
      requestId: 'req-admin-retry'
    });

    const result = await service.retryRedeemClaim(failedClaim.id);

    expect(result).toEqual({
      item: successClaim,
      new_balance: 456
    });
  });
});

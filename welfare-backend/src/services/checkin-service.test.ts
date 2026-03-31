import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlindboxItem, CheckinRecord } from '../types/domain.js';

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
  CheckinService,
  ConflictError,
  ForbiddenError,
  NotFoundError
} = await import('./checkin-service.js');

function createRepositoryMock() {
  return {
    getSettings: vi.fn(),
    listBlindboxItems: vi.fn(),
    createBlindboxItem: vi.fn(),
    updateBlindboxItem: vi.fn(),
    getCheckinByDate: vi.fn(),
    getCheckinById: vi.fn(),
    createCheckinPending: vi.fn(),
    markCheckinPendingRetry: vi.fn(),
    claimStalePending: vi.fn(),
    markCheckinSuccess: vi.fn(),
    markCheckinFailed: vi.fn(),
    updateCheckinRecipient: vi.fn(),
    deleteCheckinById: vi.fn(),
    listUserCheckins: vi.fn(),
    updateSettings: vi.fn(),
    getDailyStats: vi.fn(),
    getActiveUserCount: vi.fn(),
    queryAdminCheckins: vi.fn()
  };
}

function createSub2apiMock() {
  return {
    addUserBalance: vi.fn(),
    findUserByEmail: vi.fn(),
    getAdminUserById: vi.fn(),
    listAdminUserBalanceHistory: vi.fn()
  };
}

function createNormalFailedRecord(): CheckinRecord {
  return {
    id: 7,
    sub2apiUserId: 42,
    sub2apiEmail: 'linuxdo-user@linuxdo-connect.invalid',
    sub2apiUsername: 'linuxdo-user',
    linuxdoSubject: 'linuxdo-user',
    checkinDate: '2026-03-06',
    checkinMode: 'normal',
    blindboxItemId: null,
    blindboxTitle: '',
    rewardBalance: 10,
    idempotencyKey: 'welfare-checkin:normal:42:2026-03-06',
    grantStatus: 'failed',
    grantError: 'network timeout',
    sub2apiRequestId: '',
    createdAt: '2026-03-06T10:00:00.000Z',
    updatedAt: '2026-03-06T10:00:00.000Z'
  };
}

function createBlindboxFailedRecord(): CheckinRecord {
  return {
    id: 8,
    sub2apiUserId: 42,
    sub2apiEmail: 'linuxdo-user@linuxdo-connect.invalid',
    sub2apiUsername: 'linuxdo-user',
    linuxdoSubject: 'linuxdo-user',
    checkinDate: '2026-03-06',
    checkinMode: 'blindbox',
    blindboxItemId: 3,
    blindboxTitle: '好运签',
    rewardBalance: 15,
    idempotencyKey: 'welfare-checkin:blindbox:42:2026-03-06',
    grantStatus: 'failed',
    grantError: 'network timeout',
    sub2apiRequestId: '',
    createdAt: '2026-03-06T10:00:00.000Z',
    updatedAt: '2026-03-06T10:00:00.000Z'
  };
}

function createBlindboxItems(): BlindboxItem[] {
  return [
    {
      id: 1,
      title: '安稳签',
      rewardBalance: 8,
      weight: 50,
      enabled: true,
      notes: '',
      sortOrder: 0,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z'
    },
    {
      id: 3,
      title: '好运签',
      rewardBalance: 15,
      weight: 50,
      enabled: true,
      notes: '',
      sortOrder: 1,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z'
    }
  ];
}

describe('checkin service', () => {
  const repository = createRepositoryMock();
  const sub2api = createSub2apiMock();
  const service = new CheckinService(repository, sub2api, () => 0.75);

  beforeEach(() => {
    vi.clearAllMocks();
    sub2api.getAdminUserById.mockResolvedValue({
      id: 42,
      email: 'linuxdo-user@linuxdo-connect.invalid',
      username: 'linuxdo-user'
    });
    sub2api.findUserByEmail.mockResolvedValue({
      id: 42,
      email: 'linuxdo-user@linuxdo-connect.invalid',
      username: 'linuxdo-user'
    });
    sub2api.listAdminUserBalanceHistory.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
      pages: 1
    });
  });

  it('成功重试失败签到并返回更新后的记录', async () => {
    const failedRecord = createNormalFailedRecord();
    const pendingRecord: CheckinRecord = {
      ...failedRecord,
      grantStatus: 'pending',
      grantError: ''
    };
    const successRecord: CheckinRecord = {
      ...failedRecord,
      grantStatus: 'success',
      grantError: '',
      sub2apiRequestId: 'req-123'
    };

    repository.getCheckinById
      .mockResolvedValueOnce(failedRecord)
      .mockResolvedValueOnce(successRecord);
    repository.markCheckinPendingRetry.mockResolvedValue(pendingRecord);
    repository.markCheckinSuccess.mockResolvedValue(undefined);
    sub2api.addUserBalance.mockResolvedValue({
      newBalance: 88,
      requestId: 'req-123'
    });

    const result = await service.retryFailedCheckin(failedRecord.id);

    expect(repository.markCheckinPendingRetry).toHaveBeenCalledWith(failedRecord.id);
    expect(sub2api.addUserBalance).toHaveBeenCalledWith({
      userId: failedRecord.sub2apiUserId,
      amount: failedRecord.rewardBalance,
      notes: `福利签到 ${failedRecord.checkinDate}`,
      idempotencyKey: failedRecord.idempotencyKey
    });
    expect(repository.markCheckinSuccess).toHaveBeenCalledWith(failedRecord.id, 'req-123');
    expect(result).toEqual({
      item: successRecord,
      new_balance: 88,
      deleted: false,
      deleted_reason: null,
      detail_message: null
    });
  });

  it('记录不存在时抛出 NotFoundError', async () => {
    repository.getCheckinById.mockResolvedValue(null);

    await expect(service.retryFailedCheckin(999)).rejects.toBeInstanceOf(NotFoundError);
    expect(repository.markCheckinPendingRetry).not.toHaveBeenCalled();
    expect(sub2api.addUserBalance).not.toHaveBeenCalled();
  });

  it('补发失败时会回写失败状态并继续抛错', async () => {
    const failedRecord = createNormalFailedRecord();
    const pendingRecord: CheckinRecord = {
      ...failedRecord,
      grantStatus: 'pending',
      grantError: ''
    };

    repository.getCheckinById.mockResolvedValue(failedRecord);
    repository.markCheckinPendingRetry.mockResolvedValue(pendingRecord);
    repository.markCheckinFailed.mockResolvedValue(undefined);
    sub2api.addUserBalance.mockRejectedValue(new Error('upstream unavailable'));

    await expect(service.retryFailedCheckin(failedRecord.id)).rejects.toThrow(
      'upstream unavailable'
    );
    expect(repository.markCheckinFailed).toHaveBeenCalledWith(
      failedRecord.id,
      'upstream unavailable'
    );
  });

  it('补发遇到主站用户 404 时会按邮箱回查最新用户并更新本地记录', async () => {
    const failedRecord = createNormalFailedRecord();
    const pendingRecord: CheckinRecord = {
      ...failedRecord,
      grantStatus: 'pending',
      grantError: ''
    };
    const successRecord: CheckinRecord = {
      ...failedRecord,
      sub2apiUserId: 99,
      sub2apiEmail: 'linuxdo-user@linuxdo-connect.invalid',
      sub2apiUsername: 'new-user',
      grantStatus: 'success',
      grantError: '',
      sub2apiRequestId: 'req-404-fallback'
    };

    repository.getCheckinById
      .mockResolvedValueOnce(failedRecord)
      .mockResolvedValueOnce(successRecord);
    repository.markCheckinPendingRetry.mockResolvedValue(pendingRecord);
    repository.updateCheckinRecipient.mockResolvedValue(undefined);
    repository.markCheckinSuccess.mockResolvedValue(undefined);
    sub2api.getAdminUserById.mockResolvedValue(null);
    sub2api.findUserByEmail.mockResolvedValue({
      id: 99,
      email: 'linuxdo-user@linuxdo-connect.invalid',
      username: 'new-user'
    });
    sub2api.addUserBalance.mockResolvedValue({
      newBalance: 88,
      requestId: 'req-404-fallback'
    });

    const result = await service.retryFailedCheckin(failedRecord.id);

    expect(repository.updateCheckinRecipient).toHaveBeenCalledWith(failedRecord.id, {
      sub2apiUserId: 99,
      sub2apiEmail: 'linuxdo-user@linuxdo-connect.invalid',
      sub2apiUsername: 'new-user',
      linuxdoSubject: 'user'
    });
    expect(sub2api.addUserBalance).toHaveBeenCalledWith({
      userId: 99,
      amount: failedRecord.rewardBalance,
      notes: `福利签到 ${failedRecord.checkinDate}`,
      idempotencyKey: failedRecord.idempotencyKey
    });
    if (result.deleted) {
      throw new Error('expected retry success');
    }
    expect(result.item!.sub2apiUserId).toBe(99);
    expect(result.detail_message).toBe('旧主站用户 ID 已失效，已自动切换到当前主站账号后补发');
  });

  it('补发时如果主站已无该邮箱用户，会自动删除失败记录', async () => {
    const failedRecord = createNormalFailedRecord();
    const pendingRecord: CheckinRecord = {
      ...failedRecord,
      grantStatus: 'pending',
      grantError: ''
    };

    repository.getCheckinById.mockResolvedValueOnce(failedRecord);
    repository.markCheckinPendingRetry.mockResolvedValue(pendingRecord);
    repository.deleteCheckinById.mockResolvedValue(pendingRecord);
    sub2api.getAdminUserById.mockResolvedValue(null);
    sub2api.findUserByEmail.mockResolvedValue(null);

    const result = await service.retryFailedCheckin(failedRecord.id);

    expect(repository.deleteCheckinById).toHaveBeenCalledWith(failedRecord.id);
    expect(sub2api.addUserBalance).not.toHaveBeenCalled();
    expect(result).toEqual({
      item: null,
      new_balance: null,
      deleted: true,
      deleted_reason: '主站已无该邮箱用户，已自动移除这条补发记录',
      detail_message: null
    });
  });

  it('补发遇到主站 409 且主站余额流水已存在时，会自动修正为成功', async () => {
    const failedRecord = createNormalFailedRecord();
    const pendingRecord: CheckinRecord = {
      ...failedRecord,
      grantStatus: 'pending',
      grantError: ''
    };
    const successRecord: CheckinRecord = {
      ...failedRecord,
      grantStatus: 'success',
      grantError: '',
      sub2apiRequestId: 'recovered-history:11'
    };
    const { HttpError } = await import('../utils/http.js');

    repository.getCheckinById
      .mockResolvedValueOnce(failedRecord)
      .mockResolvedValueOnce(successRecord);
    repository.markCheckinPendingRetry.mockResolvedValue(pendingRecord);
    repository.markCheckinSuccess.mockResolvedValue(undefined);
    sub2api.addUserBalance.mockRejectedValue(
      new HttpError(
        409,
        JSON.stringify({
          code: 'IDEMPOTENCY_IN_PROGRESS',
          message: 'idempotent request is still processing',
          metadata: {
            retry_after: '5'
          }
        }),
        'sub2api 加余额失败: 409'
      )
    );
    sub2api.listAdminUserBalanceHistory.mockResolvedValue({
      items: [
        {
          id: 11,
          code: 'admin-balance-11',
          type: 'admin_balance',
          value: failedRecord.rewardBalance,
          status: 'used',
          notes: `福利签到 ${failedRecord.checkinDate}`,
          createdAt: failedRecord.createdAt,
          usedBy: failedRecord.sub2apiUserId,
          usedAt: failedRecord.createdAt
        }
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      pages: 1
    });

    const result = await service.retryFailedCheckin(failedRecord.id);

    expect(sub2api.listAdminUserBalanceHistory).toHaveBeenCalledWith({
      userId: failedRecord.sub2apiUserId,
      page: 1,
      pageSize: 50,
      type: 'admin_balance'
    });
    expect(repository.markCheckinSuccess).toHaveBeenCalledWith(
      failedRecord.id,
      'recovered-history:11'
    );
    expect(repository.markCheckinFailed).not.toHaveBeenCalled();
    expect(result).toEqual({
      item: successRecord,
      new_balance: null,
      deleted: false,
      deleted_reason: null,
      detail_message: '主站已确认这笔签到奖励到账，已自动修正本地状态'
    });
  });

  it('成功状态不允许重复补发', async () => {
    repository.getCheckinById.mockResolvedValue({
      ...createNormalFailedRecord(),
      grantStatus: 'success',
      grantError: ''
    } satisfies CheckinRecord);

    await expect(service.retryFailedCheckin(7)).rejects.toBeInstanceOf(ConflictError);
    expect(repository.markCheckinPendingRetry).not.toHaveBeenCalled();
  });

  it('普通签到重试失败记录时保留原始奖励值', async () => {
    const failedRecord = createNormalFailedRecord();
    const pendingRecord: CheckinRecord = {
      ...failedRecord,
      grantStatus: 'pending',
      grantError: ''
    };

    repository.getSettings.mockResolvedValue({
      checkinEnabled: true,
      blindboxEnabled: true,
      dailyRewardMinBalance: 20,
      dailyRewardMaxBalance: 20,
      timezone: 'Asia/Shanghai'
    });
    repository.getCheckinByDate.mockResolvedValue(failedRecord);
    repository.markCheckinPendingRetry.mockResolvedValue(pendingRecord);
    repository.markCheckinSuccess.mockResolvedValue(undefined);
    sub2api.addUserBalance.mockResolvedValue({
      newBalance: 108,
      requestId: 'req-keep-reward'
    });

    const result = await service.checkin({
      sub2apiUserId: failedRecord.sub2apiUserId,
      email: failedRecord.sub2apiEmail,
      linuxdoSubject: failedRecord.linuxdoSubject,
      username: 'tester',
      avatarUrl: null
    });

    expect(repository.markCheckinPendingRetry).toHaveBeenCalledWith(failedRecord.id);
    expect(sub2api.addUserBalance).toHaveBeenCalledWith({
      userId: failedRecord.sub2apiUserId,
      amount: failedRecord.rewardBalance,
      notes: `福利签到 ${failedRecord.checkinDate}`,
      idempotencyKey: failedRecord.idempotencyKey
    });
    expect(result.reward_balance).toBe(failedRecord.rewardBalance);
    expect(result.checkin_mode).toBe('normal');
  });

  it('普通签到会接管超时 pending 记录', async () => {
    const stalePending: CheckinRecord = {
      ...createNormalFailedRecord(),
      grantStatus: 'pending',
      grantError: '',
      updatedAt: '2026-03-06T09:00:00.000Z'
    };
    const recoveredPending: CheckinRecord = {
      ...stalePending,
      updatedAt: '2026-03-06T10:00:00.000Z'
    };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-06T10:01:00.000Z'));

    repository.getSettings.mockResolvedValue({
      checkinEnabled: true,
      blindboxEnabled: true,
      dailyRewardMinBalance: stalePending.rewardBalance,
      dailyRewardMaxBalance: stalePending.rewardBalance,
      timezone: 'UTC'
    });
    repository.getCheckinByDate.mockResolvedValue(stalePending);
    repository.claimStalePending.mockResolvedValue(recoveredPending);
    repository.markCheckinSuccess.mockResolvedValue(undefined);
    sub2api.addUserBalance.mockResolvedValue({
      newBalance: 99,
      requestId: 'req-stale-pending'
    });

    const result = await service.checkin({
      sub2apiUserId: stalePending.sub2apiUserId,
      email: stalePending.sub2apiEmail,
      linuxdoSubject: stalePending.linuxdoSubject,
      username: 'tester',
      avatarUrl: null
    });

    expect(repository.claimStalePending).toHaveBeenCalledWith(stalePending.id, 30000);
    expect(result.grant_status).toBe('success');

    vi.useRealTimers();
  });

  it('普通签到遇到未超时 pending 记录时继续阻止重试', async () => {
    const freshPending: CheckinRecord = {
      ...createNormalFailedRecord(),
      grantStatus: 'pending',
      grantError: '',
      updatedAt: '2026-03-06T10:00:45.000Z'
    };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-06T10:01:00.000Z'));

    repository.getSettings.mockResolvedValue({
      checkinEnabled: true,
      blindboxEnabled: true,
      dailyRewardMinBalance: freshPending.rewardBalance,
      dailyRewardMaxBalance: freshPending.rewardBalance,
      timezone: 'UTC'
    });
    repository.getCheckinByDate.mockResolvedValue(freshPending);

    await expect(
      service.checkin({
        sub2apiUserId: freshPending.sub2apiUserId,
        email: freshPending.sub2apiEmail,
        linuxdoSubject: freshPending.linuxdoSubject,
        username: 'tester',
        avatarUrl: null
      })
    ).rejects.toBeInstanceOf(ConflictError);

    expect(repository.claimStalePending).not.toHaveBeenCalled();
    expect(sub2api.addUserBalance).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('普通签到会按配置区间随机奖励', async () => {
    repository.getSettings.mockResolvedValue({
      checkinEnabled: true,
      blindboxEnabled: true,
      dailyRewardMinBalance: 50,
      dailyRewardMaxBalance: 100,
      timezone: 'UTC'
    });
    repository.getCheckinByDate.mockResolvedValueOnce(null);
    repository.createCheckinPending.mockResolvedValue({
      id: 21,
      sub2apiUserId: 42,
      sub2apiEmail: 'linuxdo-user@linuxdo-connect.invalid',
      sub2apiUsername: 'linuxdo-user',
      linuxdoSubject: 'linuxdo-user',
      checkinDate: '2026-03-06',
      checkinMode: 'normal',
      blindboxItemId: null,
      blindboxTitle: '',
      rewardBalance: 87.5,
      idempotencyKey: 'welfare-checkin:normal:42:2026-03-06',
      grantStatus: 'pending',
      grantError: '',
      sub2apiRequestId: '',
      createdAt: '2026-03-06T10:00:00.000Z',
      updatedAt: '2026-03-06T10:00:00.000Z'
    });
    repository.markCheckinSuccess.mockResolvedValue(undefined);
    sub2api.addUserBalance.mockResolvedValue({
      newBalance: 187.5,
      requestId: 'req-ranged-reward'
    });

    const result = await service.checkin({
      sub2apiUserId: 42,
      email: 'linuxdo-user@linuxdo-connect.invalid',
      linuxdoSubject: 'linuxdo-user',
      username: 'tester',
      avatarUrl: null
    });

    expect(repository.createCheckinPending).toHaveBeenCalledWith(
      expect.objectContaining({
        rewardBalance: 87.5
      })
    );
    expect(result.reward_balance).toBe(87.5);
  });

  it('盲盒签到会抽中奖项并快照奖励值', async () => {
    const blindboxItems = createBlindboxItems();
    repository.getSettings.mockResolvedValue({
      checkinEnabled: true,
      blindboxEnabled: true,
      dailyRewardMinBalance: 10,
      dailyRewardMaxBalance: 10,
      timezone: 'UTC'
    });
    repository.getCheckinByDate.mockResolvedValueOnce(null);
    repository.listBlindboxItems.mockResolvedValue(blindboxItems);
    repository.createCheckinPending.mockResolvedValue({
      id: 11,
      sub2apiUserId: 42,
      sub2apiEmail: 'linuxdo-user@linuxdo-connect.invalid',
      sub2apiUsername: 'linuxdo-user',
      linuxdoSubject: 'linuxdo-user',
      checkinDate: '2026-03-06',
      checkinMode: 'blindbox',
      blindboxItemId: 3,
      blindboxTitle: '好运签',
      rewardBalance: 15,
      idempotencyKey: 'welfare-checkin:blindbox:42:2026-03-06',
      grantStatus: 'pending',
      grantError: '',
      sub2apiRequestId: '',
      createdAt: '2026-03-06T10:00:00.000Z',
      updatedAt: '2026-03-06T10:00:00.000Z'
    });
    repository.markCheckinSuccess.mockResolvedValue(undefined);
    sub2api.addUserBalance.mockResolvedValue({
      newBalance: 115,
      requestId: 'req-blindbox'
    });

    const result = await service.checkBlindbox({
      sub2apiUserId: 42,
      email: 'linuxdo-user@linuxdo-connect.invalid',
      linuxdoSubject: 'linuxdo-user',
      username: 'tester',
      avatarUrl: null
    });

    expect(repository.createCheckinPending).toHaveBeenCalledWith(
      expect.objectContaining({
        checkinMode: 'blindbox',
        blindboxItemId: 3,
        blindboxTitle: '好运签',
        rewardBalance: 15
      })
    );
    expect(sub2api.addUserBalance).toHaveBeenCalledWith({
      userId: 42,
      amount: 15,
      notes: '福利盲盒 好运签 2026-03-06',
      idempotencyKey: 'welfare-checkin:blindbox:42:2026-03-06'
    });
    expect(result).toEqual({
      checkin_date: '2026-03-06',
      checkin_mode: 'blindbox',
      blindbox_item_id: 3,
      blindbox_title: '好运签',
      reward_balance: 15,
      new_balance: 115,
      grant_status: 'success'
    });
  });

  it('普通签到失败记录存在时不允许改抽盲盒', async () => {
    repository.getSettings.mockResolvedValue({
      checkinEnabled: true,
      blindboxEnabled: true,
      dailyRewardMinBalance: 10,
      dailyRewardMaxBalance: 10,
      timezone: 'UTC'
    });
    repository.getCheckinByDate.mockResolvedValue(createNormalFailedRecord());

    await expect(
      service.checkBlindbox({
        sub2apiUserId: 42,
        email: 'linuxdo-user@linuxdo-connect.invalid',
        linuxdoSubject: 'linuxdo-user',
        username: 'tester',
        avatarUrl: null
      })
    ).rejects.toThrow('今日已选择普通签到，不能再开启盲盒');
  });

  it('盲盒结果已锁定后失败重试不会重新抽奖', async () => {
    const failedBlindbox = createBlindboxFailedRecord();
    const pendingBlindbox: CheckinRecord = {
      ...failedBlindbox,
      grantStatus: 'pending',
      grantError: ''
    };

    repository.getSettings.mockResolvedValue({
      checkinEnabled: true,
      blindboxEnabled: false,
      dailyRewardMinBalance: 10,
      dailyRewardMaxBalance: 10,
      timezone: 'UTC'
    });
    repository.getCheckinByDate.mockResolvedValue(failedBlindbox);
    repository.markCheckinPendingRetry.mockResolvedValue(pendingBlindbox);
    repository.markCheckinSuccess.mockResolvedValue(undefined);
    sub2api.addUserBalance.mockResolvedValue({
      newBalance: 120,
      requestId: 'req-blindbox-retry'
    });

    const result = await service.checkBlindbox({
      sub2apiUserId: 42,
      email: 'linuxdo-user@linuxdo-connect.invalid',
      linuxdoSubject: 'linuxdo-user',
      username: 'tester',
      avatarUrl: null
    });

    expect(repository.listBlindboxItems).not.toHaveBeenCalled();
    expect(sub2api.addUserBalance).toHaveBeenCalledWith({
      userId: 42,
      amount: 15,
      notes: '福利盲盒 好运签 2026-03-06',
      idempotencyKey: 'welfare-checkin:blindbox:42:2026-03-06'
    });
    expect(result.blindbox_title).toBe('好运签');
    expect(result.reward_balance).toBe(15);
  });

  it('盲盒关闭且无历史记录时会拒绝开启', async () => {
    repository.getSettings.mockResolvedValue({
      checkinEnabled: true,
      blindboxEnabled: false,
      dailyRewardMinBalance: 10,
      dailyRewardMaxBalance: 10,
      timezone: 'UTC'
    });
    repository.getCheckinByDate.mockResolvedValue(null);

    await expect(
      service.checkBlindbox({
        sub2apiUserId: 42,
        email: 'linuxdo-user@linuxdo-connect.invalid',
        linuxdoSubject: 'linuxdo-user',
        username: 'tester',
        avatarUrl: null
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

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

const {
  DistributionDetectionService,
  buildMinimumLockUntil,
  summarizeUsageLogs
} = await import('./distribution-detection-service.js');

function createRiskEvent() {
  return {
    id: 1,
    sub2apiUserId: 42,
    sub2apiEmail: 'normal-user@example.com',
    sub2apiUsername: 'normal-user',
    linuxdoSubject: 'normal-user',
    sub2apiRole: 'user' as const,
    sub2apiStatus: 'disabled',
    eventType: 'distribution_ip' as const,
    status: 'active' as const,
    windowStartedAt: '2026-03-31T00:00:00.000Z',
    windowEndedAt: '2026-03-31T01:00:00.000Z',
    distinctIpCount: 4,
    ipSamples: ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'],
    firstHitAt: '2026-03-31T00:10:00.000Z',
    lastHitAt: '2026-03-31T00:40:00.000Z',
    minimumLockUntil: '2026-04-01T00:40:00.000Z',
    mainSiteSyncStatus: 'success' as const,
    mainSiteSyncError: '',
    lastScanStatus: 'success' as const,
    lastScanError: '',
    lastScanSource: 'scheduled',
    lastScannedAt: '2026-03-31T00:45:00.000Z',
    releasedBySub2apiUserId: null,
    releasedByEmail: '',
    releasedByUsername: '',
    releaseReason: '',
    releasedAt: null,
    createdAt: '2026-03-31T00:45:00.000Z',
    updatedAt: '2026-03-31T00:45:00.000Z'
  };
}

describe('distributionDetectionService helpers', () => {
  it('1 小时内命中 4 个不同 IP 会被识别出来', () => {
    const now = Date.parse('2026-03-31T01:00:00.000Z');
    const summaries = summarizeUsageLogs(
      [
        { userId: 7, ipAddress: '1.1.1.1', createdAt: '2026-03-31T00:10:00.000Z' },
        { userId: 7, ipAddress: '2.2.2.2', createdAt: '2026-03-31T00:20:00.000Z' },
        { userId: 7, ipAddress: '3.3.3.3', createdAt: '2026-03-31T00:30:00.000Z' },
        { userId: 7, ipAddress: '4.4.4.4', createdAt: '2026-03-31T00:40:00.000Z' }
      ],
      now
    );

    expect(summaries[0]).toMatchObject({
      sub2apiUserId: 7,
      distinctIpCount: 4
    });
  });

  it('相同 IP 只会去重统计一次，并忽略空 IP', () => {
    const now = Date.parse('2026-03-31T01:00:00.000Z');
    const summaries = summarizeUsageLogs(
      [
        { userId: 7, ipAddress: '1.1.1.1', createdAt: '2026-03-31T00:10:00.000Z' },
        { userId: 7, ipAddress: '1.1.1.1', createdAt: '2026-03-31T00:20:00.000Z' },
        { userId: 7, ipAddress: ' ', createdAt: '2026-03-31T00:30:00.000Z' }
      ],
      now
    );

    expect(summaries[0]).toMatchObject({
      sub2apiUserId: 7,
      distinctIpCount: 1,
      ipSamples: ['1.1.1.1']
    });
  });

  it('最短锁定时间固定为 24 小时', () => {
    const lockUntil = Date.parse(buildMinimumLockUntil(Date.parse('2026-03-31T00:00:00.000Z')));
    expect(lockUntil - Date.parse('2026-03-31T00:00:00.000Z')).toBe(24 * 60 * 60 * 1000);
  });
});

describe('DistributionDetectionService access guard', () => {
  it('4 个不同 IP 只进入观察，不会触发封禁', async () => {
    const repository = {
      syncExpiredEvents: vi.fn().mockResolvedValue(0),
      getBlockingEventByUserId: vi.fn().mockResolvedValue(null)
    };
    const sessionState = {
      getSessionVersion: vi.fn().mockResolvedValue(1),
      bumpSessionVersion: vi.fn()
    };
    const sub2api = {
      getAdminUserById: vi.fn().mockResolvedValue({
        id: 7,
        email: 'normal-user@example.com',
        username: 'normal-user',
        role: 'user',
        status: 'active'
      }),
      listAdminUsageLogs: vi.fn().mockResolvedValue({
        items: [
          { id: 1, userId: 7, ipAddress: '1.1.1.1', createdAt: new Date().toISOString(), user: null },
          { id: 2, userId: 7, ipAddress: '2.2.2.2', createdAt: new Date().toISOString(), user: null },
          { id: 3, userId: 7, ipAddress: '3.3.3.3', createdAt: new Date().toISOString(), user: null },
          { id: 4, userId: 7, ipAddress: '4.4.4.4', createdAt: new Date().toISOString(), user: null }
        ],
        total: 4,
        page: 1,
        pageSize: 200,
        pages: 1
      }),
      updateAdminUserStatus: vi.fn()
    };
    const welfare = {
      listAdminWhitelist: vi.fn().mockResolvedValue([]),
      hasAdminUserId: vi.fn().mockResolvedValue(false),
      hasLegacyAdminSubject: vi.fn().mockResolvedValue(false)
    };

    const service = new DistributionDetectionService(
      repository as never,
      sessionState as never,
      sub2api as never,
      welfare as never,
      console
    );

    const decision = await service.evaluateAccess(
      {
        sub2apiUserId: 7,
        email: 'normal-user@example.com',
        username: 'normal-user',
        linuxdoSubject: 'normal-user'
      },
      'auth'
    );

    expect(decision).toEqual({
      blockedEvent: null,
      sessionInvalidated: false
    });
    expect(sessionState.bumpSessionVersion).not.toHaveBeenCalled();
    expect(sub2api.updateAdminUserStatus).not.toHaveBeenCalled();
  });

  it('管理员账号会被豁免，不会进入风险拦截', async () => {
    const repository = {
      syncExpiredEvents: vi.fn().mockResolvedValue(0),
      getBlockingEventByUserId: vi.fn().mockResolvedValue(null)
    };
    const sessionState = {
      getSessionVersion: vi.fn().mockResolvedValue(1),
      bumpSessionVersion: vi.fn()
    };
    const sub2api = {
      getAdminUserById: vi.fn().mockResolvedValue({
        id: 7,
        email: 'admin@example.com',
        username: 'admin',
        role: 'admin',
        status: 'active'
      }),
      listAdminUsageLogs: vi.fn(),
      updateAdminUserStatus: vi.fn()
    };
    const welfare = {
      listAdminWhitelist: vi.fn().mockResolvedValue([]),
      hasAdminUserId: vi.fn().mockResolvedValue(false),
      hasLegacyAdminSubject: vi.fn().mockResolvedValue(false)
    };

    const service = new DistributionDetectionService(
      repository as never,
      sessionState as never,
      sub2api as never,
      welfare as never,
      console
    );

    const decision = await service.evaluateAccess(
      {
        sub2apiUserId: 7,
        email: 'admin@example.com',
        username: 'admin',
        linuxdoSubject: null
      },
      'auth'
    );

    expect(decision).toEqual({
      blockedEvent: null,
      sessionInvalidated: false
    });
    expect(sub2api.listAdminUsageLogs).not.toHaveBeenCalled();
  });

  it('已有活跃事件时不会重复创建或重复封禁', async () => {
    const existingEvent = createRiskEvent();
    const repository = {
      syncExpiredEvents: vi.fn().mockResolvedValue(0),
      getBlockingEventByUserId: vi.fn().mockResolvedValue(existingEvent)
    };
    const sessionState = {
      getSessionVersion: vi.fn().mockResolvedValue(2),
      bumpSessionVersion: vi.fn()
    };
    const sub2api = {
      getAdminUserById: vi.fn(),
      listAdminUsageLogs: vi.fn(),
      updateAdminUserStatus: vi.fn()
    };
    const welfare = {
      listAdminWhitelist: vi.fn(),
      hasAdminUserId: vi.fn().mockResolvedValue(false),
      hasLegacyAdminSubject: vi.fn().mockResolvedValue(false)
    };

    const service = new DistributionDetectionService(
      repository as never,
      sessionState as never,
      sub2api as never,
      welfare as never,
      console
    );

    const decision = await service.evaluateAccess(
      {
        sub2apiUserId: 42,
        email: 'normal-user@example.com',
        username: 'normal-user',
        linuxdoSubject: 'normal-user'
      },
      'auth'
    );

    expect(decision.blockedEvent).toEqual(existingEvent);
    expect(decision.sessionInvalidated).toBe(false);
    expect(sessionState.bumpSessionVersion).not.toHaveBeenCalled();
    expect(sub2api.updateAdminUserStatus).not.toHaveBeenCalled();
  });

  it('风险事件列表刷新时会同步主站状态漂移', async () => {
    const existingEvent = createRiskEvent();
    const repository = {
      syncExpiredEvents: vi.fn().mockResolvedValue(0),
      listRiskEventsForStatuses: vi.fn().mockResolvedValue([existingEvent]),
      listRiskEvents: vi.fn().mockResolvedValue({
        items: [
          {
            ...existingEvent,
            sub2apiStatus: 'active',
            mainSiteSyncStatus: 'failed',
            mainSiteSyncError: '主站状态已与本地封禁事件不一致'
          }
        ],
        total: 1
      }),
      updateRiskEventSync: vi.fn().mockResolvedValue({
        ...existingEvent,
        sub2apiStatus: 'active',
        mainSiteSyncStatus: 'failed',
        mainSiteSyncError: '主站状态已与本地封禁事件不一致'
      })
    };
    const sessionState = {
      getSessionVersion: vi.fn(),
      bumpSessionVersion: vi.fn()
    };
    const sub2api = {
      getAdminUserById: vi.fn().mockResolvedValue({
        id: 42,
        email: 'normal-user@example.com',
        username: 'normal-user',
        role: 'user',
        status: 'active'
      }),
      listAdminUsageLogs: vi.fn(),
      updateAdminUserStatus: vi.fn()
    };
    const welfare = {
      listAdminWhitelist: vi.fn(),
      hasAdminUserId: vi.fn(),
      hasLegacyAdminSubject: vi.fn()
    };

    const service = new DistributionDetectionService(
      repository as never,
      sessionState as never,
      sub2api as never,
      welfare as never,
      console
    );

    const result = await service.listEvents({
      page: 1,
      pageSize: 20
    });

    expect(repository.updateRiskEventSync).toHaveBeenCalledWith(1, {
      sub2apiStatus: 'active',
      mainSiteSyncStatus: 'failed',
      mainSiteSyncError: '主站状态已与本地封禁事件不一致'
    });
    expect(repository.listRiskEventsForStatuses).toHaveBeenCalledWith(
      ['active', 'pending_release'],
      1000
    );
    expect(result.items[0]).toMatchObject({
      sub2apiStatus: 'active',
      mainSiteSyncStatus: 'failed'
    });
  });

  it('观察名单只返回 4 到 5 个不同 IP 的用户', async () => {
    const now = new Date().toISOString();
    const repository = {
      syncExpiredEvents: vi.fn().mockResolvedValue(0)
    };
    const sessionState = {
      getSessionVersion: vi.fn(),
      bumpSessionVersion: vi.fn()
    };
    const sub2api = {
      getAdminUserById: vi
        .fn()
        .mockResolvedValueOnce({
          id: 7,
          email: 'observe@example.com',
          username: 'observe-user',
          role: 'user',
          status: 'active'
        })
        .mockResolvedValueOnce({
          id: 8,
          email: 'ban@example.com',
          username: 'ban-user',
          role: 'user',
          status: 'active'
        }),
      listAdminUsageLogs: vi.fn().mockResolvedValue({
        items: [
          { id: 1, userId: 7, ipAddress: '1.1.1.1', createdAt: now, user: null },
          { id: 2, userId: 7, ipAddress: '2.2.2.2', createdAt: now, user: null },
          { id: 3, userId: 7, ipAddress: '3.3.3.3', createdAt: now, user: null },
          { id: 4, userId: 7, ipAddress: '4.4.4.4', createdAt: now, user: null },
          { id: 5, userId: 8, ipAddress: '5.5.5.1', createdAt: now, user: null },
          { id: 6, userId: 8, ipAddress: '5.5.5.2', createdAt: now, user: null },
          { id: 7, userId: 8, ipAddress: '5.5.5.3', createdAt: now, user: null },
          { id: 8, userId: 8, ipAddress: '5.5.5.4', createdAt: now, user: null },
          { id: 9, userId: 8, ipAddress: '5.5.5.5', createdAt: now, user: null },
          { id: 10, userId: 8, ipAddress: '5.5.5.6', createdAt: now, user: null }
        ],
        total: 10,
        page: 1,
        pageSize: 200,
        pages: 1
      }),
      updateAdminUserStatus: vi.fn()
    };
    const welfare = {
      listAdminWhitelist: vi.fn().mockResolvedValue([]),
      hasAdminUserId: vi.fn(),
      hasLegacyAdminSubject: vi.fn()
    };

    const service = new DistributionDetectionService(
      repository as never,
      sessionState as never,
      sub2api as never,
      welfare as never,
      console
    );

    const result = await service.listObservations({
      page: 1,
      pageSize: 20
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      sub2apiUserId: 7,
      window1hIpCount: 4
    });
  });
});

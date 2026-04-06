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

function buildUsageSnapshot(entries: Array<{
  userId: number;
  email: string;
  username: string;
  linuxdoSubject: string | null;
  role: 'admin' | 'user';
  status: string;
  ipAddress: string;
  createdAt: string;
  createdAtMs: number;
}>) {
  return {
    generatedAt: new Date().toISOString(),
    rawUsageCount24h: entries.length,
    effectiveUsageCount24h: entries.length,
    excludedCount24h: 0,
    excludedBreakdown: {
      invalidCreatedAt: 0,
      missingUserId: 0,
      missingIpAddress: 0,
      outsideWindow: 0
    },
    entries: entries.map((item, index) => ({
      usageId: index + 1,
      ...item
    })),
    usageSyncState: {
      lastStartedAt: new Date().toISOString(),
      lastFinishedAt: new Date().toISOString(),
      lastStatus: 'success' as const,
      lastError: '',
      fetchedPageCount: 1,
      upsertedCount: entries.length,
      updatedAt: new Date().toISOString()
    }
  };
}

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
      updateAdminUserStatus: vi.fn()
    };
    const usageAnalysis = {
      getSnapshot: vi.fn().mockResolvedValue(
        buildUsageSnapshot([
          { userId: 7, email: 'normal-user@example.com', username: 'normal-user', linuxdoSubject: 'normal-user', role: 'user', status: 'active', ipAddress: '1.1.1.1', createdAt: new Date().toISOString(), createdAtMs: Date.now() },
          { userId: 7, email: 'normal-user@example.com', username: 'normal-user', linuxdoSubject: 'normal-user', role: 'user', status: 'active', ipAddress: '2.2.2.2', createdAt: new Date().toISOString(), createdAtMs: Date.now() },
          { userId: 7, email: 'normal-user@example.com', username: 'normal-user', linuxdoSubject: 'normal-user', role: 'user', status: 'active', ipAddress: '3.3.3.3', createdAt: new Date().toISOString(), createdAtMs: Date.now() },
          { userId: 7, email: 'normal-user@example.com', username: 'normal-user', linuxdoSubject: 'normal-user', role: 'user', status: 'active', ipAddress: '4.4.4.4', createdAt: new Date().toISOString(), createdAtMs: Date.now() }
        ])
      )
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
      console,
      usageAnalysis as never
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
      updateAdminUserStatus: vi.fn()
    };
    const usageAnalysis = {
      getSnapshot: vi.fn()
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
      console,
      usageAnalysis as never
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
    expect(usageAnalysis.getSnapshot).not.toHaveBeenCalled();
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
      updateAdminUserStatus: vi.fn()
    };
    const usageAnalysis = {
      getSnapshot: vi.fn()
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
      console,
      usageAnalysis as never
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
            status: 'released',
            sub2apiStatus: 'active',
            mainSiteSyncStatus: 'success',
            mainSiteSyncError: '',
            releasedByUsername: 'system-sync',
            releaseReason: '检测到主站已手动恢复，福利站自动同步释放',
            releasedAt: '2026-03-31T02:00:00.000Z'
          }
        ],
        total: 1
      }),
      releaseRiskEvent: vi.fn().mockResolvedValue({
        ...existingEvent,
        status: 'released',
        sub2apiStatus: 'active',
        mainSiteSyncStatus: 'success',
        mainSiteSyncError: '',
        releasedByUsername: 'system-sync',
        releaseReason: '检测到主站已手动恢复，福利站自动同步释放',
        releasedAt: '2026-03-31T02:00:00.000Z'
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
      updateAdminUserStatus: vi.fn()
    };
    const usageAnalysis = {
      getSnapshot: vi.fn()
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
      console,
      usageAnalysis as never
    );

    const result = await service.listEvents({
      page: 1,
      pageSize: 20
    });

    expect(repository.releaseRiskEvent).toHaveBeenCalledTimes(1);
    expect(repository.listRiskEventsForStatuses).toHaveBeenCalledWith(
      ['active', 'pending_release'],
      1000
    );
    expect(result.items[0]).toMatchObject({
      sub2apiStatus: 'active',
      status: 'released'
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
      getAdminUserById: vi.fn(),
      updateAdminUserStatus: vi.fn()
    };
    const usageAnalysis = {
      getSnapshot: vi.fn().mockResolvedValue(
        buildUsageSnapshot([
          { userId: 7, email: 'observe@example.com', username: 'observe-user', linuxdoSubject: null, role: 'user', status: 'active', ipAddress: '1.1.1.1', createdAt: now, createdAtMs: Date.parse(now) },
          { userId: 7, email: 'observe@example.com', username: 'observe-user', linuxdoSubject: null, role: 'user', status: 'active', ipAddress: '2.2.2.2', createdAt: now, createdAtMs: Date.parse(now) },
          { userId: 7, email: 'observe@example.com', username: 'observe-user', linuxdoSubject: null, role: 'user', status: 'active', ipAddress: '3.3.3.3', createdAt: now, createdAtMs: Date.parse(now) },
          { userId: 7, email: 'observe@example.com', username: 'observe-user', linuxdoSubject: null, role: 'user', status: 'active', ipAddress: '4.4.4.4', createdAt: now, createdAtMs: Date.parse(now) },
          { userId: 8, email: 'ban@example.com', username: 'ban-user', linuxdoSubject: null, role: 'user', status: 'active', ipAddress: '5.5.5.1', createdAt: now, createdAtMs: Date.parse(now) },
          { userId: 8, email: 'ban@example.com', username: 'ban-user', linuxdoSubject: null, role: 'user', status: 'active', ipAddress: '5.5.5.2', createdAt: now, createdAtMs: Date.parse(now) },
          { userId: 8, email: 'ban@example.com', username: 'ban-user', linuxdoSubject: null, role: 'user', status: 'active', ipAddress: '5.5.5.3', createdAt: now, createdAtMs: Date.parse(now) },
          { userId: 8, email: 'ban@example.com', username: 'ban-user', linuxdoSubject: null, role: 'user', status: 'active', ipAddress: '5.5.5.4', createdAt: now, createdAtMs: Date.parse(now) },
          { userId: 8, email: 'ban@example.com', username: 'ban-user', linuxdoSubject: null, role: 'user', status: 'active', ipAddress: '5.5.5.5', createdAt: now, createdAtMs: Date.parse(now) },
          { userId: 8, email: 'ban@example.com', username: 'ban-user', linuxdoSubject: null, role: 'user', status: 'active', ipAddress: '5.5.5.6', createdAt: now, createdAtMs: Date.parse(now) }
        ])
      )
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
      console,
      usageAnalysis as never
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

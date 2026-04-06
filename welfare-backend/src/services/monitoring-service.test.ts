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

function buildUsageSnapshot(
  entries: Array<{
    userId: number;
    email: string;
    username: string;
    linuxdoSubject: string | null;
    role: 'admin' | 'user';
    status: string;
    ipAddress: string;
    createdAt: string;
    createdAtMs: number;
  }>
) {
  return {
    generatedAt: '2026-04-05T10:00:00.000Z',
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
      lastStartedAt: '2026-04-05T09:59:00.000Z',
      lastFinishedAt: '2026-04-05T09:59:30.000Z',
      lastStatus: 'success' as const,
      lastError: '',
      fetchedPageCount: 1,
      upsertedCount: entries.length,
      updatedAt: '2026-04-05T09:59:30.000Z'
    }
  };
}

describe('buildMonitoringAggregateIndex', () => {
  it('按用户和 IP 聚合 1h / 24h 数据', async () => {
    const { buildMonitoringAggregateIndex } = await import('./monitoring-service.js');
    const result = buildMonitoringAggregateIndex({
      entries: [
        {
          userId: 1,
          email: 'u1@example.com',
          username: 'u1',
          linuxdoSubject: null,
          role: 'user',
          status: 'active',
          ipAddress: '1.1.1.1',
          createdAt: '2026-04-05T09:50:00.000Z',
          createdAtMs: Date.parse('2026-04-05T09:50:00.000Z')
        },
        {
          userId: 1,
          email: 'u1@example.com',
          username: 'u1',
          linuxdoSubject: null,
          role: 'user',
          status: 'active',
          ipAddress: '2.2.2.2',
          createdAt: '2026-04-05T09:55:00.000Z',
          createdAtMs: Date.parse('2026-04-05T09:55:00.000Z')
        },
        {
          userId: 2,
          email: 'u2@example.com',
          username: 'u2',
          linuxdoSubject: null,
          role: 'user',
          status: 'active',
          ipAddress: '2.2.2.2',
          createdAt: '2026-04-05T09:58:00.000Z',
          createdAtMs: Date.parse('2026-04-05T09:58:00.000Z')
        }
      ],
      nowMs: Date.parse('2026-04-05T10:00:00.000Z'),
      observeIpThreshold: 2,
      blockIpThreshold: 3,
      openRiskEvents: [
        {
          id: 9,
          sub2apiUserId: 1,
          status: 'active'
        }
      ],
      protectedUsers: {
        protectedUserIds: new Set<number>(),
        protectedSubjects: new Set<string>()
      }
    });

    expect(result.summary.requestCount24h).toBe(3);
    expect(result.summary.observeUserCount1h).toBe(1);
    expect(result.summary.sharedIpCount1h).toBe(1);
    expect(result.users[0]?.sub2apiUserId).toBe(1);
    expect(result.users[0]?.riskStatus).toBe('active');
    expect(result.ips[0]?.ipAddress).toBe('2.2.2.2');
    expect(result.ips[0]?.userCount24h).toBe(2);
  });
});

describe('MonitoringService aggregate cache', () => {
  it('会复用同一批监控聚合并支持按 IP 关键字过滤', async () => {
    const { MonitoringService } = await import('./monitoring-service.js');

    const listRiskEventsForStatuses = vi.fn().mockResolvedValue([]);
    const usageAnalysis = {
      getSnapshot: vi.fn().mockResolvedValue(
        buildUsageSnapshot([
          {
            userId: 7,
            email: 'u7@example.com',
            username: 'u7',
            linuxdoSubject: null,
            role: 'user',
            status: 'active',
            ipAddress: '152.53.88.113',
            createdAt: '2026-04-05T09:55:00.000Z',
            createdAtMs: Date.parse('2026-04-05T09:55:00.000Z')
          },
          {
            userId: 8,
            email: 'u8@example.com',
            username: 'u8',
            linuxdoSubject: null,
            role: 'user',
            status: 'active',
            ipAddress: '38.14.250.69',
            createdAt: '2026-04-05T09:56:00.000Z',
            createdAtMs: Date.parse('2026-04-05T09:56:00.000Z')
          }
        ])
      )
    };
    const listAdminWhitelist = vi.fn().mockResolvedValue([]);

    const service = new MonitoringService(
      {
        listActions: vi.fn(),
        listSnapshots: vi.fn(),
        createAction: vi.fn(),
        saveSnapshot: vi.fn(),
        purgeSnapshotsOlderThan: vi.fn()
      } as never,
      {
        listRiskEventsForStatuses
      } as never,
      {
        bumpSessionVersion: vi.fn()
      } as never,
      {
        getAdminUserById: vi.fn(),
        updateAdminUserStatus: vi.fn()
      } as never,
      {
        listAdminWhitelist
      } as never,
      {
        getOverview: vi.fn()
      } as never,
      {
        isConfigured: vi.fn().mockReturnValue(false),
        getDisabledReason: vi.fn().mockReturnValue(''),
        listIpAccessRules: vi.fn()
      } as never,
      console,
      usageAnalysis as never
    );

    const filtered = await service.listIps({
      page: 1,
      pageSize: 10,
      search: '152.53'
    });
    const detail = await service.getIpUsers('152.53.88.113');

    expect(filtered.items.map((item) => item.ipAddress)).toEqual(['152.53.88.113']);
    expect(detail.ip.ipAddress).toBe('152.53.88.113');
    expect(usageAnalysis.getSnapshot).toHaveBeenCalledTimes(1);
    expect(listRiskEventsForStatuses).toHaveBeenCalledTimes(1);
    expect(listAdminWhitelist).toHaveBeenCalledTimes(1);
  });
});

describe('MonitoringService Cloudflare', () => {
  it('支持按 IP 关键字过滤共享 IP 榜', async () => {
    const { MonitoringService } = await import('./monitoring-service.js');
    const usageAnalysis = {
      getSnapshot: vi.fn().mockResolvedValue(
        buildUsageSnapshot([
          {
            userId: 7,
            email: 'u7@example.com',
            username: 'u7',
            linuxdoSubject: null,
            role: 'user',
            status: 'active',
            ipAddress: '152.53.88.113',
            createdAt: '2026-04-05T09:55:00.000Z',
            createdAtMs: Date.parse('2026-04-05T09:55:00.000Z')
          },
          {
            userId: 8,
            email: 'u8@example.com',
            username: 'u8',
            linuxdoSubject: null,
            role: 'user',
            status: 'active',
            ipAddress: '38.14.250.69',
            createdAt: '2026-04-05T09:56:00.000Z',
            createdAtMs: Date.parse('2026-04-05T09:56:00.000Z')
          }
        ])
      )
    };

    const service = new MonitoringService(
      {
        listActions: vi.fn(),
        listSnapshots: vi.fn(),
        createAction: vi.fn(),
        saveSnapshot: vi.fn(),
        purgeSnapshotsOlderThan: vi.fn()
      } as never,
      {
        listRiskEventsForStatuses: vi.fn().mockResolvedValue([])
      } as never,
      {
        bumpSessionVersion: vi.fn()
      } as never,
      {
        getAdminUserById: vi.fn(),
        updateAdminUserStatus: vi.fn()
      } as never,
      {
        listAdminWhitelist: vi.fn().mockResolvedValue([])
      } as never,
      {
        getOverview: vi.fn()
      } as never,
      {
        isConfigured: vi.fn().mockReturnValue(false),
        getDisabledReason: vi.fn().mockReturnValue('未配置 Cloudflare')
      } as never,
      console,
      usageAnalysis as never
    );

    const result = await service.listIps({
      page: 1,
      pageSize: 10,
      search: '152.53'
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.ipAddress).toBe('152.53.88.113');
  });

  it('检测到外部 Cloudflare 规则时禁止面板覆盖', async () => {
    const { MonitoringService } = await import('./monitoring-service.js');
    const usageAnalysis = {
      getSnapshot: vi.fn().mockResolvedValue(
        buildUsageSnapshot([
          {
            userId: 7,
            email: 'u7@example.com',
            username: 'u7',
            linuxdoSubject: null,
            role: 'user',
            status: 'active',
            ipAddress: '1.1.1.1',
            createdAt: '2026-04-05T09:55:00.000Z',
            createdAtMs: Date.parse('2026-04-05T09:55:00.000Z')
          }
        ])
      )
    };

    const service = new MonitoringService(
      {
        listActions: vi.fn(),
        listSnapshots: vi.fn(),
        createAction: vi.fn(),
        saveSnapshot: vi.fn(),
        purgeSnapshotsOlderThan: vi.fn()
      } as never,
      {
        listRiskEventsForStatuses: vi.fn().mockResolvedValue([])
      } as never,
      {
        bumpSessionVersion: vi.fn()
      } as never,
      {
        getAdminUserById: vi.fn(),
        updateAdminUserStatus: vi.fn()
      } as never,
      {
        listAdminWhitelist: vi.fn().mockResolvedValue([])
      } as never,
      {
        getOverview: vi.fn()
      } as never,
      {
        isConfigured: vi.fn().mockReturnValue(true),
        getDisabledReason: vi.fn().mockReturnValue(''),
        listIpAccessRules: vi.fn().mockResolvedValue([
          {
            id: 'cf-rule-1',
            mode: 'block',
            target: 'ip',
            value: '1.1.1.1',
            notes: 'manual-cloudflare-rule',
            createdAt: '2026-04-05T09:00:00.000Z',
            modifiedAt: '2026-04-05T09:10:00.000Z'
          }
        ])
      } as never,
      console,
      usageAnalysis as never
    );

    const result = await service.getIpCloudflareStatus('1.1.1.1');

    expect(result.enabled).toBe(true);
    expect(result.canManage).toBe(false);
    expect(result.rule?.source).toBe('external');
    expect(result.disabledReason).toContain('非福利站托管');
  });

  it('在缓存窗口内复用聚合结果，并在风险扫描后失效缓存', async () => {
    const { MonitoringService } = await import('./monitoring-service.js');

    const repository = {
      listActions: vi.fn().mockResolvedValue({
        items: [],
        total: 0
      }),
      listSnapshots: vi.fn().mockResolvedValue([]),
      createAction: vi.fn().mockResolvedValue(undefined),
      saveSnapshot: vi.fn(),
      purgeSnapshotsOlderThan: vi.fn()
    };
    const riskRepository = {
      listRiskEventsForStatuses: vi.fn().mockResolvedValue([]),
      getBlockingEventByUserId: vi.fn()
    };
    const welfare = {
      listAdminWhitelist: vi.fn().mockResolvedValue([])
    };
    const sub2api = {
      getAdminUserById: vi.fn(),
      updateAdminUserStatus: vi.fn()
    };
    const usageAnalysis = {
      getSnapshot: vi
        .fn()
        .mockResolvedValue(
          buildUsageSnapshot([
            {
              userId: 7,
              email: 'u7@example.com',
              username: 'u7',
              linuxdoSubject: null,
              role: 'user',
              status: 'active',
              ipAddress: '152.53.88.113',
              createdAt: '2026-04-05T09:55:00.000Z',
              createdAtMs: Date.parse('2026-04-05T09:55:00.000Z')
            },
            {
              userId: 8,
              email: 'u8@example.com',
              username: 'u8',
              linuxdoSubject: null,
              role: 'user',
              status: 'active',
              ipAddress: '8.8.8.8',
              createdAt: '2026-04-05T09:57:00.000Z',
              createdAtMs: Date.parse('2026-04-05T09:57:00.000Z')
            }
          ])
        )
    };

    const service = new MonitoringService(
      repository as never,
      riskRepository as never,
      {
        bumpSessionVersion: vi.fn()
      } as never,
      sub2api as never,
      welfare as never,
      {
        getOverview: vi.fn()
      } as never,
      {
        isConfigured: vi.fn().mockReturnValue(false),
        getDisabledReason: vi.fn().mockReturnValue(''),
        listIpAccessRules: vi.fn()
      } as never,
      console,
      usageAnalysis as never
    );

    const firstPage = await service.listIps({
      page: 1,
      pageSize: 10,
      search: '152.53'
    });
    const usersPage = await service.listUsers({
      page: 1,
      pageSize: 10
    });

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]?.ipAddress).toBe('152.53.88.113');
    expect(usersPage.total).toBe(2);
    expect(usageAnalysis.getSnapshot).toHaveBeenCalledTimes(1);
    expect(riskRepository.listRiskEventsForStatuses).toHaveBeenCalledTimes(1);
    expect(welfare.listAdminWhitelist).toHaveBeenCalledTimes(1);

    await service.recordRiskScanAction(
      {
        sub2apiUserId: 1,
        email: 'admin@example.com',
        username: 'admin'
      },
      {
        matchedUserCount: 1,
        createdEventCount: 1,
        refreshedEventCount: 0,
        status: 'success',
        detail: 'manual risk scan'
      }
    );
    await service.listIps({
      page: 1,
      pageSize: 10
    });

    expect(usageAnalysis.getSnapshot).toHaveBeenCalledTimes(2);
  });
});

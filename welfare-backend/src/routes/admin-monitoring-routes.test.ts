import express from 'express';
import request from 'supertest';
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

const mockMonitoringService = vi.hoisted(() => ({
  getOverview: vi.fn(),
  listIps: vi.fn(),
  getIpUsers: vi.fn(),
  getIpCloudflareStatus: vi.fn(),
  listUsers: vi.fn(),
  getUserIps: vi.fn(),
  listActions: vi.fn(),
  disableUser: vi.fn(),
  enableUser: vi.fn(),
  challengeIp: vi.fn(),
  blockIp: vi.fn(),
  unblockIp: vi.fn(),
  recordRiskScanAction: vi.fn(),
  recordRiskReleaseAction: vi.fn()
}));

const mockDistributionService = vi.hoisted(() => ({
  getOverview: vi.fn(),
  listObservations: vi.fn(),
  listEvents: vi.fn(),
  runBatchScan: vi.fn(),
  releaseEvent: vi.fn()
}));

vi.mock('../services/monitoring-service.js', () => ({
  monitoringService: mockMonitoringService,
  MonitoringConflictError: class extends Error {},
  MonitoringFeatureUnavailableError: class extends Error {},
  MonitoringNotFoundError: class extends Error {},
  MonitoringUpstreamError: class extends Error {}
}));

vi.mock('../services/distribution-detection-service.js', () => ({
  distributionDetectionService: mockDistributionService,
  RiskConflictError: class extends Error {},
  RiskNotFoundError: class extends Error {}
}));

async function createTestApp() {
  const { adminMonitoringRouter } = await import('./admin-monitoring-routes.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionUser = {
      sub2apiUserId: 1,
      email: 'admin@example.com',
      linuxdoSubject: 'admin',
      username: 'admin',
      avatarUrl: null
    };
    next();
  });
  app.use('/api/admin/monitoring', adminMonitoringRouter);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({
      code: 500,
      message: 'INTERNAL_ERROR',
      detail: error instanceof Error ? error.message : 'unknown error'
    });
  });
  return app;
}

describe('adminMonitoringRouter', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(mockMonitoringService).forEach((fn) => fn.mockReset());
    Object.values(mockDistributionService).forEach((fn) => fn.mockReset());
  });

  it('GET /overview 返回监控总览', async () => {
    mockMonitoringService.getOverview.mockResolvedValue({
      generatedAt: '2026-04-05T08:00:00.000Z',
      thresholds: {
        observeIpCount: 4,
        blockIpCount: 6,
        lockDurationMs: 86_400_000,
        liveCacheTtlMs: 30_000,
        snapshotIntervalMs: 3_600_000
      },
      summary: {
        requestCount24h: 120,
        activeUserCount24h: 20,
        uniqueIpCount24h: 16,
        observeUserCount1h: 3,
        blockedUserCount: 1,
        pendingReleaseCount: 2,
        sharedIpCount1h: 4,
        sharedIpCount24h: 7
      },
      windows: {
        observeUserCount1h: 3,
        observeUserCount24h: 5,
        sharedUserCount24h: 9,
        sharedIpCount1h: 4,
        sharedIpCount24h: 7
      },
      lastScan: {
        lastStartedAt: null,
        lastFinishedAt: null,
        lastStatus: 'success',
        lastError: '',
        lastTriggerSource: 'scheduled',
        scannedUserCount: 12,
        hitUserCount: 3,
        updatedAt: '2026-04-05T08:00:00.000Z'
      },
      snapshotPoints: [],
      recentActions: []
    });

    const app = await createTestApp();
    const response = await request(app).get('/api/admin/monitoring/overview');

    expect(response.status).toBe(200);
    expect(response.body.data.generated_at).toBe('2026-04-05T08:00:00.000Z');
    expect(response.body.data.summary.request_count_24h).toBe(120);
  });

  it('GET /ips 支持按 IP 关键字搜索', async () => {
    mockMonitoringService.listIps.mockResolvedValue({
      items: [],
      total: 0,
      generatedAt: '2026-04-05T08:00:00.000Z'
    });

    const app = await createTestApp();
    const response = await request(app).get('/api/admin/monitoring/ips?page=2&page_size=5&search=152.53');

    expect(response.status).toBe(200);
    expect(mockMonitoringService.listIps).toHaveBeenCalledWith({
      page: 2,
      pageSize: 5,
      search: '152.53'
    });
    expect(response.body.data.search).toBe('152.53');
  });

  it('POST /users/:id/disable 在服务冲突时返回 409', async () => {
    const { MonitoringConflictError } = await import('../services/monitoring-service.js');
    mockMonitoringService.disableUser.mockRejectedValue(
      new MonitoringConflictError('不能禁用当前登录管理员')
    );

    const app = await createTestApp();
    const response = await request(app)
      .post('/api/admin/monitoring/users/1/disable')
      .send({ reason: 'test' });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('MONITORING_CONFLICT');
  });

  it('GET /ips/:ip/cloudflare 返回 Cloudflare IP 规则状态', async () => {
    mockMonitoringService.getIpCloudflareStatus.mockResolvedValue({
      ipAddress: '1.1.1.1',
      enabled: true,
      canManage: true,
      disabledReason: '',
      matchedRuleCount: 1,
      rule: {
        id: 'rule-1',
        mode: 'managed_challenge',
        source: 'managed',
        notes: 'welfare-monitoring|mode=managed_challenge',
        createdAt: '2026-04-05T08:00:00.000Z',
        modifiedAt: '2026-04-05T08:05:00.000Z'
      }
    });

    const app = await createTestApp();
    const response = await request(app).get('/api/admin/monitoring/ips/1.1.1.1/cloudflare');

    expect(response.status).toBe(200);
    expect(response.body.data.ip_address).toBe('1.1.1.1');
    expect(response.body.data.rule.mode).toBe('managed_challenge');
  });

  it('POST /ips/:ip/block 在未配置 Cloudflare 时返回 503', async () => {
    const { MonitoringFeatureUnavailableError } = await import('../services/monitoring-service.js');
    mockMonitoringService.blockIp.mockRejectedValue(
      new MonitoringFeatureUnavailableError('未配置 Cloudflare IP 访问规则集成')
    );

    const app = await createTestApp();
    const response = await request(app)
      .post('/api/admin/monitoring/ips/1.1.1.1/block')
      .send({ reason: 'manual' });

    expect(response.status).toBe(503);
    expect(response.body.message).toBe('CLOUDFLARE_NOT_CONFIGURED');
  });

  it('DELETE /ips/:ip/cloudflare 返回解除后的状态', async () => {
    mockMonitoringService.unblockIp.mockResolvedValue({
      ipAddress: '1.1.1.1',
      enabled: true,
      canManage: true,
      disabledReason: '',
      matchedRuleCount: 0,
      rule: null
    });

    const app = await createTestApp();
    const response = await request(app)
      .delete('/api/admin/monitoring/ips/1.1.1.1/cloudflare')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.item.rule).toBeNull();
  });

  it('POST /risk-events/scan 会记录扫描审计', async () => {
    mockDistributionService.runBatchScan.mockResolvedValue({
      scannedLogCount: 25,
      matchedUserCount: 3,
      createdEventCount: 1,
      refreshedEventCount: 2,
      skippedAdminCount: 0,
      retriedMainSiteCount: 3,
      lastScan: {
        lastStartedAt: null,
        lastFinishedAt: null,
        lastStatus: 'success',
        lastError: '',
        lastTriggerSource: 'manual',
        scannedUserCount: 12,
        hitUserCount: 3,
        updatedAt: '2026-04-05T08:00:00.000Z'
      }
    });

    const app = await createTestApp();
    const response = await request(app).post('/api/admin/monitoring/risk-events/scan');

    expect(response.status).toBe(200);
    expect(response.body.data.matched_user_count).toBe(3);
    expect(mockMonitoringService.recordRiskScanAction).toHaveBeenCalled();
  });
});

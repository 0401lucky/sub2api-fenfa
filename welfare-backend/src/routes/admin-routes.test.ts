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

const mockCheckinService = vi.hoisted(() => ({
  getAdminSettings: vi.fn(),
  updateAdminSettings: vi.fn(),
  listAdminBlindboxItems: vi.fn(),
  createAdminBlindboxItem: vi.fn(),
  updateAdminBlindboxItem: vi.fn(),
  getAdminDailyStats: vi.fn(),
  getAdminCheckins: vi.fn(),
  retryFailedCheckin: vi.fn()
}));

const mockWelfareRepository = vi.hoisted(() => ({
  listAdminWhitelist: vi.fn(),
  addAdminWhitelist: vi.fn(),
  removeAdminWhitelist: vi.fn()
}));
const mockSub2apiClient = vi.hoisted(() => ({
  searchAdminUsers: vi.fn()
}));

const mockRedeemService = vi.hoisted(() => ({
  listAdminRedeemCodes: vi.fn(),
  createAdminRedeemCode: vi.fn(),
  updateAdminRedeemCode: vi.fn(),
  getAdminRedeemClaims: vi.fn(),
  retryRedeemClaim: vi.fn()
}));

const mockResetService = vi.hoisted(() => ({
  getAdminResetRecords: vi.fn()
}));

vi.mock('../middleware/auth-middleware.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.sessionUser = {
      sub2apiUserId: 1,
      email: 'linuxdo-self-admin@linuxdo-connect.invalid',
      linuxdoSubject: 'self-admin',
      username: 'tester',
      avatarUrl: null
    };
    next();
  }
}));

vi.mock('../middleware/admin-middleware.js', () => ({
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    next();
  }
}));

vi.mock('../services/checkin-service.js', () => ({
  checkinService: mockCheckinService,
  welfareRepository: mockWelfareRepository,
  ConflictError: class extends Error {},
  NotFoundError: class extends Error {}
}));

vi.mock('../services/redeem-service.js', () => ({
  redeemService: mockRedeemService,
  ConflictError: class extends Error {},
  ForbiddenError: class extends Error {},
  NotFoundError: class extends Error {}
}));

vi.mock('../services/sub2api-client.js', () => ({
  sub2apiClient: mockSub2apiClient
}));

vi.mock('../services/reset-service.js', () => ({
  resetService: mockResetService
}));

async function createTestApp() {
  const { adminRouter } = await import('./admin-routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({
      code: 500,
      message: 'INTERNAL_ERROR',
      detail: error instanceof Error ? error.message : 'unknown error'
    });
  });
  return app;
}

describe('adminRouter', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(mockCheckinService).forEach((fn) => fn.mockReset());
    Object.values(mockWelfareRepository).forEach((fn) => fn.mockReset());
    Object.values(mockRedeemService).forEach((fn) => fn.mockReset());
    Object.values(mockResetService).forEach((fn) => fn.mockReset());
  });

  it('PUT /settings 在 timezone 非法时返回 400', async () => {
    const app = await createTestApp();
    const response = await request(app)
      .put('/api/admin/settings')
      .send({ timezone: 'Not/A_Real_Timezone' });

    expect(response.status).toBe(400);
    expect(response.body.detail).toBe('timezone 非法');
    expect(mockCheckinService.updateAdminSettings).not.toHaveBeenCalled();
  });

  it('GET /overview 返回聚合总览数据', async () => {
    mockCheckinService.getAdminSettings.mockResolvedValue({
      checkinEnabled: true,
      blindboxEnabled: true,
      dailyRewardMinBalance: 10,
      dailyRewardMaxBalance: 20,
      timezone: 'Asia/Shanghai',
      resetEnabled: true,
      resetThresholdBalance: 20,
      resetTargetBalance: 200,
      resetCooldownDays: 7,
      resetNotice: '余额低于阈值时可直接重置'
    });
    mockCheckinService.getAdminDailyStats.mockResolvedValue({
      days: 30,
      active_users: 5,
      total_checkins: 10,
      total_grant_balance: 100,
      points: []
    });
    mockWelfareRepository.listAdminWhitelist.mockResolvedValue([]);

    const app = await createTestApp();
    const response = await request(app).get('/api/admin/overview');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.settings).toEqual({
      checkin_enabled: true,
      blindbox_enabled: true,
      daily_reward_min_balance: 10,
      daily_reward_max_balance: 20,
      timezone: 'Asia/Shanghai',
      reset_enabled: true,
      reset_threshold_balance: 20,
      reset_target_balance: 200,
      reset_cooldown_days: 7,
      reset_notice: '余额低于阈值时可直接重置'
    });
    expect(response.body.data.stats.total_grant_balance).toBe(100);
  });

  it('GET /reset-records 返回重置流水分页结果', async () => {
    mockResetService.getAdminResetRecords.mockResolvedValue({
      items: [
        {
          id: 3,
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
          createdAt: '2026-03-30T08:00:00.000Z',
          updatedAt: '2026-03-30T08:00:01.000Z'
        }
      ],
      total: 1
    });

    const app = await createTestApp();
    const response = await request(app).get('/api/admin/reset-records?page=1&page_size=20');

    expect(response.status).toBe(200);
    expect(response.body.data.items[0]).toEqual(
      expect.objectContaining({
        sub2apiUserId: 7,
        grantedBalance: 188,
        grantStatus: 'success'
      })
    );
  });

  it('DELETE /whitelist/:id 会阻止删除当前登录管理员', async () => {
    mockWelfareRepository.listAdminWhitelist.mockResolvedValue([
      {
        id: 1,
        sub2apiUserId: 1,
        email: 'linuxdo-self-admin@linuxdo-connect.invalid',
        username: 'tester',
        linuxdoSubject: 'self-admin',
        notes: '',
        createdAt: '2026-03-26T00:00:00.000Z'
      },
      {
        id: 2,
        sub2apiUserId: 2,
        email: 'other@example.com',
        username: 'other-admin',
        linuxdoSubject: 'other-admin',
        notes: '',
        createdAt: '2026-03-26T00:00:00.000Z'
      }
    ]);

    const app = await createTestApp();
    const response = await request(app).delete('/api/admin/whitelist/1');

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('WHITELIST_CONFLICT');
    expect(mockWelfareRepository.removeAdminWhitelist).not.toHaveBeenCalled();
  });

  it('DELETE /whitelist/:id 允许删除其他管理员', async () => {
    mockWelfareRepository.listAdminWhitelist.mockResolvedValue([
      {
        id: 1,
        sub2apiUserId: 1,
        email: 'linuxdo-self-admin@linuxdo-connect.invalid',
        username: 'tester',
        linuxdoSubject: 'self-admin',
        notes: '',
        createdAt: '2026-03-26T00:00:00.000Z'
      },
      {
        id: 2,
        sub2apiUserId: 2,
        email: 'other@example.com',
        username: 'other-admin',
        linuxdoSubject: 'other-admin',
        notes: '',
        createdAt: '2026-03-26T00:00:00.000Z'
      }
    ]);
    mockWelfareRepository.removeAdminWhitelist.mockResolvedValue(true);

    const app = await createTestApp();
    const response = await request(app).delete('/api/admin/whitelist/2');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ deleted: true });
    expect(mockWelfareRepository.removeAdminWhitelist).toHaveBeenCalledWith(2);
  });
});

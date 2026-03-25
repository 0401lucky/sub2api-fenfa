import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheckinService = vi.hoisted(() => ({
  getAdminSettings: vi.fn(),
  updateAdminSettings: vi.fn(),
  getAdminDailyStats: vi.fn(),
  getAdminCheckins: vi.fn(),
  retryFailedCheckin: vi.fn()
}));

const mockWelfareRepository = vi.hoisted(() => ({
  listAdminWhitelist: vi.fn(),
  addAdminWhitelist: vi.fn(),
  removeAdminWhitelist: vi.fn()
}));

const mockRedeemService = vi.hoisted(() => ({
  listAdminRedeemCodes: vi.fn(),
  createAdminRedeemCode: vi.fn(),
  updateAdminRedeemCode: vi.fn(),
  getAdminRedeemClaims: vi.fn(),
  retryRedeemClaim: vi.fn()
}));

vi.mock('../middleware/auth-middleware.js', () => ({
  requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
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
      dailyRewardBalance: 10,
      timezone: 'Asia/Shanghai'
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
    expect(response.body.data.settings).toEqual({
      checkin_enabled: true,
      daily_reward_balance: 10,
      timezone: 'Asia/Shanghai'
    });
    expect(response.body.data.stats.total_grant_balance).toBe(100);
  });
});

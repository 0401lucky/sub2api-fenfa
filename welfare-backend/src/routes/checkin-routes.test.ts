import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCheckinService,
  ConflictError,
  ForbiddenError
} = vi.hoisted(() => ({
  mockCheckinService: {
    getStatus: vi.fn(),
    getHistory: vi.fn(),
    checkin: vi.fn()
  },
  ConflictError: class extends Error {},
  ForbiddenError: class extends Error {}
}));

vi.mock('../middleware/auth-middleware.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.sessionUser = {
      sub2apiUserId: 1,
      linuxdoSubject: 'subject',
      syntheticEmail: 'linuxdo-subject@linuxdo-connect.invalid',
      username: 'tester',
      avatarUrl: null
    };
    next();
  }
}));

vi.mock('../services/checkin-service.js', () => ({
  checkinService: mockCheckinService,
  ConflictError,
  ForbiddenError
}));

async function createTestApp() {
  const { checkinRouter } = await import('./checkin-routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/checkin', checkinRouter);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({
      code: 500,
      message: 'INTERNAL_ERROR',
      detail: error instanceof Error ? error.message : 'unknown error'
    });
  });
  return app;
}

describe('checkinRouter', () => {
  beforeEach(() => {
    vi.resetModules();
    mockCheckinService.getStatus.mockReset();
    mockCheckinService.getHistory.mockReset();
    mockCheckinService.checkin.mockReset();
  });

  it('GET /status 返回签到状态', async () => {
    mockCheckinService.getStatus.mockResolvedValue({
      checkin_enabled: true,
      can_checkin: true
    });

    const app = await createTestApp();
    const response = await request(app).get('/api/checkin/status');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      checkin_enabled: true,
      can_checkin: true
    });
  });

  it('POST / 在签到冲突时返回 409', async () => {
    mockCheckinService.checkin.mockRejectedValue(new ConflictError('今日已签到'));

    const app = await createTestApp();
    const response = await request(app).post('/api/checkin');

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('CHECKIN_CONFLICT');
  });

  it('POST / 在上游发放失败时返回 502', async () => {
    const { HttpError } = await import('../utils/http.js');
    mockCheckinService.checkin.mockRejectedValue(new HttpError(502, 'bad gateway'));

    const app = await createTestApp();
    const response = await request(app).post('/api/checkin');

    expect(response.status).toBe(502);
    expect(response.body.message).toBe('SUB2API_GRANT_FAILED');
  });
});

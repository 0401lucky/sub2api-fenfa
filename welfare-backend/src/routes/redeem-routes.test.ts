import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRedeemService,
  ConflictError,
  ForbiddenError,
  NotFoundError
} = vi.hoisted(() => ({
  mockRedeemService: {
    getHistory: vi.fn(),
    redeem: vi.fn()
  },
  ConflictError: class extends Error {},
  ForbiddenError: class extends Error {},
  NotFoundError: class extends Error {}
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

vi.mock('../services/redeem-service.js', () => ({
  redeemService: mockRedeemService,
  ConflictError,
  ForbiddenError,
  NotFoundError
}));

async function createTestApp() {
  const { redeemRouter } = await import('./redeem-routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/redeem-codes', redeemRouter);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({
      code: 500,
      message: 'INTERNAL_ERROR',
      detail: error instanceof Error ? error.message : 'unknown error'
    });
  });
  return app;
}

describe('redeemRouter', () => {
  beforeEach(() => {
    vi.resetModules();
    mockRedeemService.getHistory.mockReset();
    mockRedeemService.redeem.mockReset();
  });

  it('POST /redeem 在兑换码不存在时返回 404', async () => {
    mockRedeemService.redeem.mockRejectedValue(new NotFoundError('兑换码不存在'));

    const app = await createTestApp();
    const response = await request(app)
      .post('/api/redeem-codes/redeem')
      .send({ code: 'NOPE' });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('REDEEM_CODE_NOT_FOUND');
  });

  it('POST /redeem 在上游发放失败时返回 502', async () => {
    const { HttpError } = await import('../utils/http.js');
    mockRedeemService.redeem.mockRejectedValue(new HttpError(502, 'bad gateway'));

    const app = await createTestApp();
    const response = await request(app)
      .post('/api/redeem-codes/redeem')
      .send({ code: 'WELCOME100' });

    expect(response.status).toBe(502);
    expect(response.body.message).toBe('SUB2API_GRANT_FAILED');
  });
});

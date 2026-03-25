import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAuth } from './auth-middleware.js';
import { sessionService } from '../services/session-service.js';
import { sessionStateService } from '../services/session-state-service.js';

vi.mock('../services/session-service.js', () => ({
  sessionService: {
    verifySession: vi.fn()
  }
}));

vi.mock('../services/session-state-service.js', () => ({
  sessionStateService: {
    isTokenRevoked: vi.fn()
  }
}));

function createResponse(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn()
  } as unknown as Response;
}

describe('requireAuth', () => {
  const next = vi.fn();

  beforeEach(() => {
    next.mockReset();
    vi.mocked(sessionService.verifySession).mockReset();
    vi.mocked(sessionStateService.isTokenRevoked).mockReset();
  });

  it('使用 Authorization header 中的 Bearer token 进行认证', async () => {
    vi.mocked(sessionService.verifySession).mockReturnValue({
      user: {
        sub2apiUserId: 1,
        linuxdoSubject: 'subject',
        syntheticEmail: 'linuxdo-subject@linuxdo-connect.invalid',
        username: 'tester',
        avatarUrl: null
      },
      tokenId: 'token-id',
      expiresAtMs: 1_800_000_000_000
    });
    vi.mocked(sessionStateService.isTokenRevoked).mockResolvedValue(false);

    const req = {
      header: vi.fn().mockReturnValue('Bearer header-token')
    } as unknown as Request;
    const res = createResponse();

    requireAuth(req, res, next);

    await vi.waitFor(() => {
      expect(next).toHaveBeenCalledTimes(1);
    });

    expect(sessionService.verifySession).toHaveBeenCalledWith('header-token');
    expect(sessionStateService.isTokenRevoked).toHaveBeenCalledWith('token-id');
    expect(req.sessionTokenId).toBe('token-id');
  });

  it('在 Authorization header 缺失时返回 401', () => {
    const req = {
      header: vi.fn().mockReturnValue(undefined)
    } as unknown as Request;
    const res = createResponse();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('已撤销 token 会返回 401', async () => {
    vi.mocked(sessionService.verifySession).mockReturnValue({
      user: {
        sub2apiUserId: 1,
        linuxdoSubject: 'subject',
        syntheticEmail: 'linuxdo-subject@linuxdo-connect.invalid',
        username: 'tester',
        avatarUrl: null
      },
      tokenId: 'revoked-token',
      expiresAtMs: 1_800_000_000_000
    });
    vi.mocked(sessionStateService.isTokenRevoked).mockResolvedValue(true);

    const req = {
      header: vi.fn().mockReturnValue('Bearer revoked')
    } as unknown as Request;
    const res = createResponse();

    requireAuth(req, res, next);

    await vi.waitFor(() => {
      expect(res.status).toHaveBeenCalledWith(401);
    });
    expect(next).not.toHaveBeenCalled();
  });
});

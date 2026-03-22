import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAuth } from './auth-middleware.js';
import { sessionService } from '../services/session-service.js';

vi.mock('../services/session-service.js', () => ({
  sessionService: {
    verify: vi.fn()
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
    vi.mocked(sessionService.verify).mockReset();
  });

  it('优先使用 Cookie 中的会话 token', () => {
    vi.mocked(sessionService.verify).mockReturnValue({
      sub2apiUserId: 1,
      linuxdoSubject: 'subject',
      syntheticEmail: 'linuxdo-subject@linuxdo-connect.invalid',
      username: 'tester',
      avatarUrl: null
    });

    const req = {
      cookies: {
        welfare_token: 'cookie-token'
      },
      header: vi.fn().mockReturnValue('Bearer header-token')
    } as unknown as Request;
    const res = createResponse();

    requireAuth(req, res, next);

    expect(sessionService.verify).toHaveBeenCalledWith('cookie-token');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('在 Cookie 缺失时回退到 Authorization 头', () => {
    vi.mocked(sessionService.verify).mockReturnValue({
      sub2apiUserId: 1,
      linuxdoSubject: 'subject',
      syntheticEmail: 'linuxdo-subject@linuxdo-connect.invalid',
      username: 'tester',
      avatarUrl: null
    });

    const req = {
      cookies: {},
      header: vi.fn().mockReturnValue('Bearer header-token')
    } as unknown as Request;
    const res = createResponse();

    requireAuth(req, res, next);

    expect(sessionService.verify).toHaveBeenCalledWith('header-token');
    expect(next).toHaveBeenCalledTimes(1);
  });
});

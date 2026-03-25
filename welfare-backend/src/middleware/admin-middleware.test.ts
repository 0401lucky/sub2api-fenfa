import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAdmin } from './admin-middleware.js';
import { welfareRepository } from '../services/checkin-service.js';

vi.mock('../services/checkin-service.js', () => ({
  welfareRepository: {
    hasAdminSubject: vi.fn()
  }
}));

function createResponse(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn()
  } as unknown as Response;
}

describe('requireAdmin', () => {
  const next = vi.fn();

  beforeEach(() => {
    next.mockReset();
    vi.mocked(welfareRepository.hasAdminSubject).mockReset();
  });

  it('白名单命中时进入下一个处理器', async () => {
    vi.mocked(welfareRepository.hasAdminSubject).mockResolvedValue(true);
    const req = {
      sessionUser: {
        sub2apiUserId: 1,
        linuxdoSubject: 'subject',
        syntheticEmail: 'linuxdo-subject@linuxdo-connect.invalid',
        username: 'tester',
        avatarUrl: null
      }
    } as Request;
    const res = createResponse();

    requireAdmin(req, res, next);
    await vi.waitFor(() => {
      expect(next).toHaveBeenCalledTimes(1);
    });

    expect(welfareRepository.hasAdminSubject).toHaveBeenCalledWith('subject');
  });

  it('数据库异常时会把错误交给 next，而不是产生未处理拒绝', async () => {
    const error = new Error('db down');
    vi.mocked(welfareRepository.hasAdminSubject).mockRejectedValue(error);
    const req = {
      sessionUser: {
        sub2apiUserId: 1,
        linuxdoSubject: 'subject',
        syntheticEmail: 'linuxdo-subject@linuxdo-connect.invalid',
        username: 'tester',
        avatarUrl: null
      }
    } as Request;
    const res = createResponse();

    requireAdmin(req, res, next);
    await vi.waitFor(() => {
      expect(next).toHaveBeenCalledWith(error);
    });
  });
});

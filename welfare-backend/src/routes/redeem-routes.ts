import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth-middleware.js';
import {
  redeemService,
  ConflictError,
  ForbiddenError,
  NotFoundError
} from '../services/redeem-service.js';
import { fail, ok } from '../utils/response.js';
import { HttpError } from '../utils/http.js';
import { asyncHandler } from '../utils/async-handler.js';

const redeemBodySchema = z.object({
  code: z.string().min(1).max(64)
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional()
});

export const redeemRouter = Router();

redeemRouter.use(requireAuth);

redeemRouter.get('/history', asyncHandler(async (req, res) => {
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', 'limit 参数非法');
    return;
  }

  const data = await redeemService.getHistory(
    req.sessionUser!,
    parsed.data.limit ?? 30
  );
  ok(res, data);
}));

redeemRouter.post('/redeem', asyncHandler(async (req, res) => {
  const parsed = redeemBodySchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? '参数非法');
    return;
  }

  try {
    const data = await redeemService.redeem(req.sessionUser!, parsed.data.code);
    ok(res, data);
  } catch (error) {
    if (error instanceof NotFoundError) {
      fail(res, 404, 'REDEEM_CODE_NOT_FOUND', error.message);
      return;
    }

    if (error instanceof ConflictError) {
      fail(res, 409, 'REDEEM_CONFLICT', error.message);
      return;
    }

    if (error instanceof ForbiddenError) {
      fail(res, 403, 'REDEEM_UNAVAILABLE', error.message);
      return;
    }

    if (error instanceof HttpError) {
      console.error('[redeem] sub2api 发放失败', error);
      fail(res, 502, 'SUB2API_GRANT_FAILED', '额度发放失败，请稍后重试');
      return;
    }

    console.error('[redeem] 兑换处理失败', error);
    fail(res, 500, 'REDEEM_FAILED', '兑换失败，请稍后重试');
  }
}));

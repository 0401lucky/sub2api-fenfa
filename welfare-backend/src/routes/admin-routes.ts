import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth-middleware.js';
import { requireAdmin } from '../middleware/admin-middleware.js';
import type { CheckinRecord, RedeemClaim, RedeemCode } from '../types/domain.js';
import {
  checkinService,
  ConflictError,
  NotFoundError,
  welfareRepository
} from '../services/checkin-service.js';
import {
  redeemService,
  ConflictError as RedeemConflictError,
  ForbiddenError as RedeemForbiddenError,
  NotFoundError as RedeemNotFoundError
} from '../services/redeem-service.js';
import { isSafeLinuxDoSubject } from '../utils/oauth.js';
import { isValidTimezone } from '../utils/date.js';
import { fail, ok } from '../utils/response.js';
import { asyncHandler } from '../utils/async-handler.js';

function toAdminCheckinPayload(record: CheckinRecord) {
  return {
    id: record.id,
    sub2apiUserId: record.sub2apiUserId,
    linuxdoSubject: record.linuxdoSubject,
    syntheticEmail: record.syntheticEmail,
    checkinDate: record.checkinDate,
    rewardBalance: record.rewardBalance,
    idempotencyKey: record.idempotencyKey,
    grantStatus: record.grantStatus,
    grantError: record.grantError,
    sub2apiRequestId: record.sub2apiRequestId,
    createdAt: record.createdAt
  };
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }

  return expiresAtMs <= Date.now();
}

function toAdminRedeemCodePayload(item: RedeemCode) {
  return {
    id: item.id,
    code: item.code,
    title: item.title,
    rewardBalance: item.rewardBalance,
    maxClaims: item.maxClaims,
    claimedCount: item.claimedCount,
    remainingClaims: Math.max(0, item.maxClaims - item.claimedCount),
    enabled: item.enabled,
    expiresAt: item.expiresAt,
    isExpired: isExpired(item.expiresAt),
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function toAdminRedeemClaimPayload(item: RedeemClaim) {
  return {
    id: item.id,
    redeemCodeId: item.redeemCodeId,
    redeemCode: item.redeemCode,
    redeemTitle: item.redeemTitle,
    sub2apiUserId: item.sub2apiUserId,
    linuxdoSubject: item.linuxdoSubject,
    syntheticEmail: item.syntheticEmail,
    rewardBalance: item.rewardBalance,
    idempotencyKey: item.idempotencyKey,
    grantStatus: item.grantStatus,
    grantError: item.grantError,
    sub2apiRequestId: item.sub2apiRequestId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function parseOptionalDateTime(value: string | null | undefined) {
  if (value === undefined) {
    return {
      ok: true as const,
      value: undefined
    };
  }

  if (value === null) {
    return {
      ok: true as const,
      value: null
    };
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return {
      ok: true as const,
      value: null
    };
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return {
      ok: false as const
    };
  }

  return {
    ok: true as const,
    value: date.toISOString()
  };
}

const settingsUpdateSchema = z.object({
  checkin_enabled: z.boolean().optional(),
  daily_reward_balance: z.number().positive().optional(),
  timezone: z.string().min(1).optional()
});

const statsQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(180).optional()
});

const checkinsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(200).optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  grant_status: z.enum(['pending', 'success', 'failed']).optional(),
  subject: z.string().max(64).optional()
});

const whitelistCreateSchema = z.object({
  linuxdo_subject: z.string().min(1).max(64),
  notes: z.string().max(500).optional()
});

const redeemCodeCreateSchema = z.object({
  code: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  reward_balance: z.number().positive(),
  max_claims: z.number().int().positive().max(1_000_000),
  enabled: z.boolean().optional(),
  expires_at: z.union([z.string().max(64), z.null()]).optional(),
  notes: z.string().max(500).optional()
});

const redeemCodeUpdateSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  expires_at: z.union([z.string().max(64), z.null()]).optional(),
  notes: z.string().max(500).optional()
});

const redeemClaimsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(200).optional(),
  grant_status: z.enum(['pending', 'success', 'failed']).optional(),
  subject: z.string().max(64).optional(),
  code: z.string().max(64).optional()
});

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/overview', asyncHandler(async (_req, res) => {
  const [settings, stats, whitelist] = await Promise.all([
    checkinService.getAdminSettings(),
    checkinService.getAdminDailyStats(30),
    welfareRepository.listAdminWhitelist()
  ]);

  ok(res, {
    settings: {
      checkin_enabled: settings.checkinEnabled,
      daily_reward_balance: settings.dailyRewardBalance,
      timezone: settings.timezone
    },
    stats,
    whitelist
  });
}));

adminRouter.get('/settings', asyncHandler(async (_req, res) => {
  const settings = await checkinService.getAdminSettings();
  ok(res, {
    checkin_enabled: settings.checkinEnabled,
    daily_reward_balance: settings.dailyRewardBalance,
    timezone: settings.timezone
  });
}));

adminRouter.put('/settings', asyncHandler(async (req, res) => {
  const parsed = settingsUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? '参数非法');
    return;
  }

  const payload = parsed.data;
  if (payload.timezone && !isValidTimezone(payload.timezone)) {
    fail(res, 400, 'BAD_REQUEST', 'timezone 非法');
    return;
  }

  const settings = await checkinService.updateAdminSettings({
    checkinEnabled: payload.checkin_enabled,
    dailyRewardBalance: payload.daily_reward_balance,
    timezone: payload.timezone
  });
  ok(res, {
    checkin_enabled: settings.checkinEnabled,
    daily_reward_balance: settings.dailyRewardBalance,
    timezone: settings.timezone
  });
}));

adminRouter.get('/stats/daily', asyncHandler(async (req, res) => {
  const parsed = statsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', 'days 参数非法');
    return;
  }
  const data = await checkinService.getAdminDailyStats(parsed.data.days ?? 30);
  ok(res, data);
}));

adminRouter.get('/checkins', asyncHandler(async (req, res) => {
  const parsed = checkinsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', '查询参数非法');
    return;
  }

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.page_size ?? 20;
  const result = await checkinService.getAdminCheckins({
    page,
    pageSize,
    dateFrom: parsed.data.date_from,
    dateTo: parsed.data.date_to,
    grantStatus: parsed.data.grant_status,
    subject: parsed.data.subject?.trim() || undefined
  });
  ok(res, {
    items: result.items.map((item) => toAdminCheckinPayload(item)),
    total: result.total,
    page,
    page_size: pageSize,
    pages: Math.max(1, Math.ceil(result.total / pageSize))
  });
}));

adminRouter.post('/checkins/:id/retry', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, 'BAD_REQUEST', 'id 非法');
    return;
  }

  try {
    const result = await checkinService.retryFailedCheckin(id);
    ok(res, {
      item: toAdminCheckinPayload(result.item),
      new_balance: result.new_balance
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      fail(res, 404, 'NOT_FOUND', error.message);
      return;
    }
    if (error instanceof ConflictError) {
      fail(res, 409, 'CHECKIN_CONFLICT', error.message);
      return;
    }
    console.error('[admin] 签到补发失败', error);
    fail(res, 500, 'CHECKIN_RETRY_FAILED', '补发失败，请稍后重试');
  }
}));

adminRouter.get('/whitelist', asyncHandler(async (_req, res) => {
  const data = await welfareRepository.listAdminWhitelist();
  ok(res, data);
}));

adminRouter.post('/whitelist', asyncHandler(async (req, res) => {
  const parsed = whitelistCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? '参数非法');
    return;
  }

  const subject = parsed.data.linuxdo_subject.trim();
  if (!isSafeLinuxDoSubject(subject)) {
    fail(res, 400, 'BAD_REQUEST', 'linuxdo_subject 格式非法');
    return;
  }

  const item = await welfareRepository.addAdminWhitelist(
    subject,
    parsed.data.notes?.trim() ?? ''
  );
  ok(res, item);
}));

adminRouter.delete('/whitelist/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, 'BAD_REQUEST', 'id 非法');
    return;
  }
  const deleted = await welfareRepository.removeAdminWhitelist(id);
  if (!deleted) {
    fail(res, 404, 'NOT_FOUND', '白名单记录不存在');
    return;
  }
  ok(res, { deleted: true });
}));

adminRouter.get('/redeem-codes', asyncHandler(async (_req, res) => {
  const data = await redeemService.listAdminRedeemCodes();
  ok(res, data.map((item) => toAdminRedeemCodePayload(item)));
}));

adminRouter.post('/redeem-codes', asyncHandler(async (req, res) => {
  const parsed = redeemCodeCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? '参数非法');
    return;
  }

  const code = parsed.data.code.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(code)) {
    fail(res, 400, 'BAD_REQUEST', '兑换码格式非法，仅支持字母、数字、下划线和短横线');
    return;
  }

  const expiresAt = parseOptionalDateTime(parsed.data.expires_at);
  if (!expiresAt.ok) {
    fail(res, 400, 'BAD_REQUEST', 'expires_at 非法');
    return;
  }

  try {
    const item = await redeemService.createAdminRedeemCode({
      code,
      title: parsed.data.title.trim(),
      rewardBalance: parsed.data.reward_balance,
      maxClaims: parsed.data.max_claims,
      enabled: parsed.data.enabled ?? true,
      expiresAt: expiresAt.value ?? null,
      notes: parsed.data.notes?.trim() ?? ''
    });
    ok(res, toAdminRedeemCodePayload(item));
  } catch (error) {
    if (error instanceof RedeemConflictError) {
      fail(res, 409, 'REDEEM_CONFLICT', error.message);
      return;
    }
    throw error;
  }
}));

adminRouter.patch('/redeem-codes/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, 'BAD_REQUEST', 'id 非法');
    return;
  }

  const parsed = redeemCodeUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? '参数非法');
    return;
  }

  const expiresAt = parseOptionalDateTime(parsed.data.expires_at);
  if (!expiresAt.ok) {
    fail(res, 400, 'BAD_REQUEST', 'expires_at 非法');
    return;
  }

  try {
    const item = await redeemService.updateAdminRedeemCode(id, {
      title: parsed.data.title?.trim(),
      enabled: parsed.data.enabled,
      expiresAt: expiresAt.value,
      notes: parsed.data.notes?.trim()
    });
    ok(res, toAdminRedeemCodePayload(item));
  } catch (error) {
    if (error instanceof RedeemNotFoundError) {
      fail(res, 404, 'NOT_FOUND', error.message);
      return;
    }
    throw error;
  }
}));

adminRouter.get('/redeem-claims', asyncHandler(async (req, res) => {
  const parsed = redeemClaimsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', '查询参数非法');
    return;
  }

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.page_size ?? 20;
  const result = await redeemService.getAdminRedeemClaims({
    page,
    pageSize,
    grantStatus: parsed.data.grant_status,
    subject: parsed.data.subject?.trim() || undefined,
    code: parsed.data.code?.trim().toUpperCase() || undefined
  });
  ok(res, {
    items: result.items.map((item) => toAdminRedeemClaimPayload(item)),
    total: result.total,
    page,
    page_size: pageSize,
    pages: Math.max(1, Math.ceil(result.total / pageSize))
  });
}));

adminRouter.post('/redeem-claims/:id/retry', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, 'BAD_REQUEST', 'id 非法');
    return;
  }

  try {
    const result = await redeemService.retryRedeemClaim(id);
    ok(res, {
      item: toAdminRedeemClaimPayload(result.item),
      new_balance: result.new_balance
    });
  } catch (error) {
    if (error instanceof RedeemNotFoundError) {
      fail(res, 404, 'NOT_FOUND', error.message);
      return;
    }
    if (error instanceof RedeemConflictError) {
      fail(res, 409, 'REDEEM_CONFLICT', error.message);
      return;
    }
    if (error instanceof RedeemForbiddenError) {
      fail(res, 403, 'REDEEM_UNAVAILABLE', error.message);
      return;
    }
    console.error('[admin] 兑换补发失败', error);
    fail(res, 500, 'REDEEM_RETRY_FAILED', '补发失败，请稍后重试');
  }
}));

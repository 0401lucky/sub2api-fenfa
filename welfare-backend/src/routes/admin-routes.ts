import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth-middleware.js';
import {
  createRateLimitMiddleware,
  keyBySessionUser
} from '../middleware/rate-limit-middleware.js';
import { requireAdmin } from '../middleware/admin-middleware.js';
import type {
  CheckinRecord,
  RedeemClaim,
  RedeemCode,
  ResetRecord
} from '../types/domain.js';
import {
  checkinService,
  ConflictError,
  NotFoundError,
  welfareRepository
} from '../services/checkin-service.js';
import { resetService } from '../services/reset-service.js';
import { userCleanupService } from '../services/user-cleanup-service.js';
import {
  distributionDetectionService,
  RiskConflictError,
  RiskNotFoundError
} from '../services/distribution-detection-service.js';
import {
  redeemService,
  ConflictError as RedeemConflictError,
  ForbiddenError as RedeemForbiddenError,
  NotFoundError as RedeemNotFoundError
} from '../services/redeem-service.js';
import { Sub2apiResponseError, sub2apiClient } from '../services/sub2api-client.js';
import { extractLinuxDoSubjectFromEmail, isSafeLinuxDoSubject } from '../utils/oauth.js';
import { isValidTimezone } from '../utils/date.js';
import { HttpError } from '../utils/http.js';
import { fail, ok } from '../utils/response.js';
import { asyncHandler } from '../utils/async-handler.js';

function toAdminCheckinPayload(record: CheckinRecord) {
  return {
    id: record.id,
    sub2apiUserId: record.sub2apiUserId,
    sub2apiEmail: record.sub2apiEmail,
    sub2apiUsername: record.sub2apiUsername,
    linuxdoSubject: record.linuxdoSubject,
    checkinDate: record.checkinDate,
    checkinMode: record.checkinMode,
    blindboxItemId: record.blindboxItemId,
    blindboxTitle: record.checkinMode === 'blindbox' ? record.blindboxTitle || null : null,
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
    sub2apiEmail: item.sub2apiEmail,
    sub2apiUsername: item.sub2apiUsername,
    linuxdoSubject: item.linuxdoSubject,
    rewardBalance: item.rewardBalance,
    idempotencyKey: item.idempotencyKey,
    grantStatus: item.grantStatus,
    grantError: item.grantError,
    sub2apiRequestId: item.sub2apiRequestId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function toAdminResetRecordPayload(record: ResetRecord) {
  return {
    id: record.id,
    sub2apiUserId: record.sub2apiUserId,
    sub2apiEmail: record.sub2apiEmail,
    sub2apiUsername: record.sub2apiUsername,
    linuxdoSubject: record.linuxdoSubject,
    beforeBalance: record.beforeBalance,
    thresholdBalance: record.thresholdBalance,
    targetBalance: record.targetBalance,
    grantedBalance: record.grantedBalance,
    newBalance: record.newBalance,
    cooldownDays: record.cooldownDays,
    idempotencyKey: record.idempotencyKey,
    grantStatus: record.grantStatus,
    grantError: record.grantError,
    sub2apiRequestId: record.sub2apiRequestId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function toAdminRiskEventPayload(event: {
  id: number;
  sub2apiUserId: number;
  sub2apiEmail: string;
  sub2apiUsername: string;
  linuxdoSubject: string | null;
  sub2apiRole: 'admin' | 'user';
  sub2apiStatus: string;
  status: 'active' | 'pending_release' | 'released';
  windowStartedAt: string;
  windowEndedAt: string;
  distinctIpCount: number;
  ipSamples: string[];
  firstHitAt: string;
  lastHitAt: string;
  minimumLockUntil: string;
  mainSiteSyncStatus: 'pending' | 'success' | 'failed';
  mainSiteSyncError: string;
  lastScanStatus: 'success' | 'failed';
  lastScanError: string;
  lastScanSource: string;
  lastScannedAt: string | null;
  releasedBySub2apiUserId: number | null;
  releasedByEmail: string;
  releasedByUsername: string;
  releaseReason: string;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: event.id,
    sub2apiUserId: event.sub2apiUserId,
    sub2apiEmail: event.sub2apiEmail,
    sub2apiUsername: event.sub2apiUsername,
    linuxdoSubject: event.linuxdoSubject,
    sub2apiRole: event.sub2apiRole,
    sub2apiStatus: event.sub2apiStatus,
    status: event.status,
    windowStartedAt: event.windowStartedAt,
    windowEndedAt: event.windowEndedAt,
    distinctIpCount: event.distinctIpCount,
    ipSamples: event.ipSamples,
    firstHitAt: event.firstHitAt,
    lastHitAt: event.lastHitAt,
    minimumLockUntil: event.minimumLockUntil,
    mainSiteSyncStatus: event.mainSiteSyncStatus,
    mainSiteSyncError: event.mainSiteSyncError,
    lastScanStatus: event.lastScanStatus,
    lastScanError: event.lastScanError,
    lastScanSource: event.lastScanSource,
    lastScannedAt: event.lastScannedAt,
    releasedBySub2apiUserId: event.releasedBySub2apiUserId,
    releasedByEmail: event.releasedByEmail,
    releasedByUsername: event.releasedByUsername,
    releaseReason: event.releaseReason,
    releasedAt: event.releasedAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt
  };
}

function toAdminRiskOverviewPayload(overview: {
  activeEventCount: number;
  pendingReleaseCount: number;
  openEventCount: number;
  observeCount1h: number;
  windows: {
    window1hObserveCount: number;
    window3hObserveCount: number;
    window6hObserveCount: number;
    window24hObserveCount: number;
  };
  lastScan: {
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    lastStatus: 'idle' | 'running' | 'success' | 'failed';
    lastError: string;
    lastTriggerSource: string;
    updatedAt: string;
  };
}) {
  return {
    active_event_count: overview.activeEventCount,
    pending_release_count: overview.pendingReleaseCount,
    open_event_count: overview.openEventCount,
    observe_count_1h: overview.observeCount1h,
    windows: {
      window_1h_observe_count: overview.windows.window1hObserveCount,
      window_3h_observe_count: overview.windows.window3hObserveCount,
      window_6h_observe_count: overview.windows.window6hObserveCount,
      window_24h_observe_count: overview.windows.window24hObserveCount
    },
    last_scan: {
      last_started_at: overview.lastScan.lastStartedAt,
      last_finished_at: overview.lastScan.lastFinishedAt,
      last_status: overview.lastScan.lastStatus,
      last_error: overview.lastScan.lastError,
      last_trigger_source: overview.lastScan.lastTriggerSource,
      updated_at: overview.lastScan.updatedAt
    }
  };
}

function toAdminRiskObservationPayload(item: {
  sub2apiUserId: number;
  sub2apiEmail: string;
  sub2apiUsername: string;
  linuxdoSubject: string | null;
  sub2apiRole: 'admin' | 'user';
  sub2apiStatus: string;
  window1hIpCount: number;
  window3hIpCount: number;
  window6hIpCount: number;
  window24hIpCount: number;
  ipSamples: string[];
  firstHitAt: string;
  lastHitAt: string;
}) {
  return {
    sub2api_user_id: item.sub2apiUserId,
    sub2api_email: item.sub2apiEmail,
    sub2api_username: item.sub2apiUsername,
    linuxdo_subject: item.linuxdoSubject,
    sub2api_role: item.sub2apiRole,
    sub2api_status: item.sub2apiStatus,
    window_1h_ip_count: item.window1hIpCount,
    window_3h_ip_count: item.window3hIpCount,
    window_6h_ip_count: item.window6hIpCount,
    window_24h_ip_count: item.window24hIpCount,
    ip_samples: item.ipSamples,
    first_hit_at: item.firstHitAt,
    last_hit_at: item.lastHitAt
  };
}

function toAdminUpstreamFailureDetail(error: HttpError | Sub2apiResponseError): string {
  if (error instanceof Sub2apiResponseError) {
    return error.message.slice(0, 300);
  }

  return `主站接口异常：HTTP ${error.status}`;
}

function toAdminBlindboxItemPayload(item: {
  id: number;
  title: string;
  rewardBalance: number;
  weight: number;
  enabled: boolean;
  notes: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: item.id,
    title: item.title,
    reward_balance: item.rewardBalance,
    weight: item.weight,
    enabled: item.enabled,
    notes: item.notes,
    sort_order: item.sortOrder,
    created_at: item.createdAt,
    updated_at: item.updatedAt
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
  blindbox_enabled: z.boolean().optional(),
  daily_reward_min_balance: z.number().positive().optional(),
  daily_reward_max_balance: z.number().positive().optional(),
  timezone: z.string().min(1).optional(),
  reset_enabled: z.boolean().optional(),
  reset_threshold_balance: z.number().min(0).optional(),
  reset_target_balance: z.number().positive().optional(),
  reset_cooldown_days: z.number().int().min(0).optional(),
  reset_notice: z.string().max(500).optional()
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
  sub2api_user_id: z.number().int().positive(),
  email: z.string().email(),
  username: z.string().min(1).max(120),
  linuxdo_subject: z.string().min(1).max(64).nullable().optional(),
  notes: z.string().max(500).optional()
});
const sub2apiUserSearchSchema = z.object({
  q: z.string().min(1).max(120)
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

const resetRecordsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(200).optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  grant_status: z.enum(['pending', 'success', 'failed']).optional(),
  subject: z.string().max(64).optional()
});

const userCleanupCandidatesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(200).optional(),
  search: z.string().max(120).optional()
});

const userCleanupDeleteSchema = z.object({
  user_ids: z.array(z.number().int().positive()).min(1).max(200)
});

const riskEventsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(200).optional(),
  status: z.enum(['active', 'pending_release', 'released']).optional()
});

const riskObservationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(200).optional()
});

const riskReleaseSchema = z.object({
  reason: z.string().max(500).optional()
});

const blindboxItemCreateSchema = z.object({
  title: z.string().min(1).max(80),
  reward_balance: z.number().positive(),
  weight: z.number().int().positive().max(1_000_000),
  enabled: z.boolean().optional(),
  notes: z.string().max(500).optional(),
  sort_order: z.number().int().min(-9999).max(9999).optional()
});

const blindboxItemUpdateSchema = z.object({
  title: z.string().min(1).max(80).optional(),
  reward_balance: z.number().positive().optional(),
  weight: z.number().int().positive().max(1_000_000).optional(),
  enabled: z.boolean().optional(),
  notes: z.string().max(500).optional(),
  sort_order: z.number().int().min(-9999).max(9999).optional()
});

const adminMutationRateLimit = createRateLimitMiddleware({
  bucket: 'admin-mutation',
  limit: config.WELFARE_RATE_LIMIT_ADMIN_MUTATION_LIMIT,
  windowMs: config.WELFARE_RATE_LIMIT_ADMIN_MUTATION_WINDOW_MS,
  keyGenerator: keyBySessionUser,
  message: '后台写操作过于频繁，请稍后再试'
});

export const adminRouter = Router();

adminRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
adminRouter.use(requireAuth, requireAdmin);
adminRouter.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    adminMutationRateLimit(req, res, next);
    return;
  }

  next();
});

adminRouter.get('/overview', asyncHandler(async (_req, res) => {
  const [settings, stats, whitelist] = await Promise.all([
    checkinService.getAdminSettings(),
    checkinService.getAdminDailyStats(30),
    welfareRepository.listAdminWhitelist()
  ]);

  ok(res, {
    settings: {
      checkin_enabled: settings.checkinEnabled,
      blindbox_enabled: settings.blindboxEnabled,
      daily_reward_min_balance: settings.dailyRewardMinBalance,
      daily_reward_max_balance: settings.dailyRewardMaxBalance,
      timezone: settings.timezone,
      reset_enabled: settings.resetEnabled,
      reset_threshold_balance: settings.resetThresholdBalance,
      reset_target_balance: settings.resetTargetBalance,
      reset_cooldown_days: settings.resetCooldownDays,
      reset_notice: settings.resetNotice
    },
    stats,
    whitelist
  });
}));

adminRouter.get('/settings', asyncHandler(async (_req, res) => {
  const settings = await checkinService.getAdminSettings();
  ok(res, {
    checkin_enabled: settings.checkinEnabled,
    blindbox_enabled: settings.blindboxEnabled,
    daily_reward_min_balance: settings.dailyRewardMinBalance,
    daily_reward_max_balance: settings.dailyRewardMaxBalance,
    timezone: settings.timezone,
    reset_enabled: settings.resetEnabled,
    reset_threshold_balance: settings.resetThresholdBalance,
    reset_target_balance: settings.resetTargetBalance,
    reset_cooldown_days: settings.resetCooldownDays,
    reset_notice: settings.resetNotice
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

  const currentSettings = await checkinService.getAdminSettings();
  const nextRewardMin =
    payload.daily_reward_min_balance ?? currentSettings.dailyRewardMinBalance;
  const nextRewardMax =
    payload.daily_reward_max_balance ?? currentSettings.dailyRewardMaxBalance;
  const nextThreshold =
    payload.reset_threshold_balance ?? currentSettings.resetThresholdBalance;
  const nextTarget =
    payload.reset_target_balance ?? currentSettings.resetTargetBalance;

  if (nextRewardMax < nextRewardMin) {
    fail(res, 400, 'BAD_REQUEST', 'daily_reward_max_balance 不能小于 daily_reward_min_balance');
    return;
  }

  if (nextTarget <= nextThreshold) {
    fail(res, 400, 'BAD_REQUEST', 'reset_target_balance 必须大于 reset_threshold_balance');
    return;
  }

  const settings = await checkinService.updateAdminSettings({
    checkinEnabled: payload.checkin_enabled,
    blindboxEnabled: payload.blindbox_enabled,
    dailyRewardMinBalance: payload.daily_reward_min_balance,
    dailyRewardMaxBalance: payload.daily_reward_max_balance,
    timezone: payload.timezone,
    resetEnabled: payload.reset_enabled,
    resetThresholdBalance: payload.reset_threshold_balance,
    resetTargetBalance: payload.reset_target_balance,
    resetCooldownDays: payload.reset_cooldown_days,
    resetNotice: payload.reset_notice?.trim()
  });
  ok(res, {
    checkin_enabled: settings.checkinEnabled,
    blindbox_enabled: settings.blindboxEnabled,
    daily_reward_min_balance: settings.dailyRewardMinBalance,
    daily_reward_max_balance: settings.dailyRewardMaxBalance,
    timezone: settings.timezone,
    reset_enabled: settings.resetEnabled,
    reset_threshold_balance: settings.resetThresholdBalance,
    reset_target_balance: settings.resetTargetBalance,
    reset_cooldown_days: settings.resetCooldownDays,
    reset_notice: settings.resetNotice
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
    if (error instanceof HttpError || error instanceof Sub2apiResponseError) {
      console.error('[admin] 签到补发失败', error);
      fail(res, 502, 'SUB2API_GRANT_FAILED', toAdminUpstreamFailureDetail(error));
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

adminRouter.get('/sub2api-users/search', asyncHandler(async (req, res) => {
  const parsed = sub2apiUserSearchSchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', 'q 参数非法');
    return;
  }

  const items = await sub2apiClient.searchAdminUsers(parsed.data.q.trim());
  ok(res, items.map((item) => ({
    sub2api_user_id: item.id,
    email: item.email,
    username: item.username || item.email,
    linuxdo_subject: extractLinuxDoSubjectFromEmail(item.email)
  })));
}));

adminRouter.get('/user-cleanup/candidates', asyncHandler(async (req, res) => {
  const parsed = userCleanupCandidatesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', '查询参数非法');
    return;
  }

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.page_size ?? 20;
  const result = await userCleanupService.listCleanupCandidates({
    page,
    pageSize,
    search: parsed.data.search?.trim() || undefined,
    currentUserId: req.sessionUser!.sub2apiUserId
  });
  ok(res, {
    items: result.items,
    total: result.total,
    page,
    page_size: pageSize,
    pages: Math.max(1, Math.ceil(result.total / pageSize))
  });
}));

adminRouter.get('/risk-events/overview', asyncHandler(async (_req, res) => {
  const overview = await distributionDetectionService.getOverview();
  ok(res, toAdminRiskOverviewPayload(overview));
}));

adminRouter.get('/risk-events/observations', asyncHandler(async (req, res) => {
  const parsed = riskObservationsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', '查询参数非法');
    return;
  }

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.page_size ?? 20;
  const result = await distributionDetectionService.listObservations({
    page,
    pageSize
  });

  ok(res, {
    items: result.items.map((item) => toAdminRiskObservationPayload(item)),
    total: result.total,
    page,
    page_size: pageSize,
    pages: Math.max(1, Math.ceil(result.total / pageSize))
  });
}));

adminRouter.get('/risk-events', asyncHandler(async (req, res) => {
  const parsed = riskEventsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', '查询参数非法');
    return;
  }

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.page_size ?? 20;
  const result = await distributionDetectionService.listEvents({
    page,
    pageSize,
    status: parsed.data.status
  });

  ok(res, {
    items: result.items.map((item) => toAdminRiskEventPayload(item)),
    total: result.total,
    page,
    page_size: pageSize,
    pages: Math.max(1, Math.ceil(result.total / pageSize))
  });
}));

adminRouter.post('/risk-events/scan', asyncHandler(async (_req, res) => {
  const result = await distributionDetectionService.runBatchScan('manual');
  ok(res, {
    scanned_log_count: result.scannedLogCount,
    matched_user_count: result.matchedUserCount,
    created_event_count: result.createdEventCount,
    refreshed_event_count: result.refreshedEventCount,
    skipped_admin_count: result.skippedAdminCount,
    retried_main_site_count: result.retriedMainSiteCount,
    last_scan: {
      last_started_at: result.lastScan.lastStartedAt,
      last_finished_at: result.lastScan.lastFinishedAt,
      last_status: result.lastScan.lastStatus,
      last_error: result.lastScan.lastError,
      last_trigger_source: result.lastScan.lastTriggerSource,
      updated_at: result.lastScan.updatedAt
    }
  });
}));

adminRouter.post('/risk-events/:id/release', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, 'BAD_REQUEST', 'id 非法');
    return;
  }

  const parsed = riskReleaseSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? '参数非法');
    return;
  }

  try {
    const item = await distributionDetectionService.releaseEvent(
      id,
      req.sessionUser!,
      parsed.data.reason?.trim() ?? ''
    );
    ok(res, {
      item: toAdminRiskEventPayload(item)
    });
  } catch (error) {
    if (error instanceof RiskNotFoundError) {
      fail(res, 404, 'NOT_FOUND', error.message);
      return;
    }
    if (error instanceof RiskConflictError) {
      fail(res, 409, 'RISK_CONFLICT', error.message);
      return;
    }
    console.error('[admin] 手动恢复风险事件失败', error);
    fail(res, 500, 'RISK_RELEASE_FAILED', '手动恢复失败，请稍后重试');
  }
}));

adminRouter.post('/user-cleanup/delete', asyncHandler(async (req, res) => {
  const parsed = userCleanupDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', 'user_ids 参数非法');
    return;
  }

  const result = await userCleanupService.deleteCleanupCandidates(
    req.sessionUser!,
    parsed.data.user_ids
  );
  ok(res, result);
}));

adminRouter.post('/whitelist', asyncHandler(async (req, res) => {
  const parsed = whitelistCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? '参数非法');
    return;
  }

  const subject = parsed.data.linuxdo_subject?.trim();
  if (subject && !isSafeLinuxDoSubject(subject)) {
    fail(res, 400, 'BAD_REQUEST', 'linuxdo_subject 格式非法');
    return;
  }

  const item = await welfareRepository.addAdminWhitelist({
    sub2apiUserId: parsed.data.sub2api_user_id,
    email: parsed.data.email.trim(),
    username: parsed.data.username.trim(),
    linuxdoSubject: subject || null,
    notes: parsed.data.notes?.trim() ?? ''
  });
  ok(res, item);
}));

adminRouter.delete('/whitelist/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, 'BAD_REQUEST', 'id 非法');
    return;
  }

  const whitelist = await welfareRepository.listAdminWhitelist();
  const currentUser = req.sessionUser!;
  const target = whitelist.find((item) => item.id === id);

  if (!target) {
    fail(res, 404, 'NOT_FOUND', '白名单记录不存在');
    return;
  }

  if (target.sub2apiUserId === currentUser.sub2apiUserId) {
    fail(res, 409, 'WHITELIST_CONFLICT', '不能删除当前登录管理员，请使用其他管理员账号操作');
    return;
  }

  if (whitelist.length - 1 < 1) {
    fail(res, 409, 'WHITELIST_CONFLICT', '至少保留一名管理员');
    return;
  }

  const deleted = await welfareRepository.removeAdminWhitelist(id);
  if (!deleted) {
    fail(res, 404, 'NOT_FOUND', '白名单记录不存在');
    return;
  }
  ok(res, { deleted: true });
}));

adminRouter.get('/blindbox/items', asyncHandler(async (_req, res) => {
  const items = await checkinService.listAdminBlindboxItems();
  ok(res, items.map((item) => toAdminBlindboxItemPayload(item)));
}));

adminRouter.post('/blindbox/items', asyncHandler(async (req, res) => {
  const parsed = blindboxItemCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? '参数非法');
    return;
  }

  const item = await checkinService.createAdminBlindboxItem({
    title: parsed.data.title.trim(),
    rewardBalance: parsed.data.reward_balance,
    weight: parsed.data.weight,
    enabled: parsed.data.enabled ?? true,
    notes: parsed.data.notes?.trim() ?? '',
    sortOrder: parsed.data.sort_order ?? 0
  });
  ok(res, toAdminBlindboxItemPayload(item));
}));

adminRouter.patch('/blindbox/items/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, 'BAD_REQUEST', 'id 非法');
    return;
  }

  const parsed = blindboxItemUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? '参数非法');
    return;
  }

  try {
    const item = await checkinService.updateAdminBlindboxItem(id, {
      title: parsed.data.title?.trim(),
      rewardBalance: parsed.data.reward_balance,
      weight: parsed.data.weight,
      enabled: parsed.data.enabled,
      notes: parsed.data.notes?.trim(),
      sortOrder: parsed.data.sort_order
    });
    ok(res, toAdminBlindboxItemPayload(item));
  } catch (error) {
    if (error instanceof NotFoundError) {
      fail(res, 404, 'NOT_FOUND', error.message);
      return;
    }
    throw error;
  }
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

adminRouter.get('/reset-records', asyncHandler(async (req, res) => {
  const parsed = resetRecordsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', '查询参数非法');
    return;
  }

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.page_size ?? 20;
  const result = await resetService.getAdminResetRecords({
    page,
    pageSize,
    dateFrom: parsed.data.date_from,
    dateTo: parsed.data.date_to,
    grantStatus: parsed.data.grant_status,
    subject: parsed.data.subject?.trim() || undefined
  });
  ok(res, {
    items: result.items.map((item) => toAdminResetRecordPayload(item)),
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
    if (error instanceof HttpError || error instanceof Sub2apiResponseError) {
      console.error('[admin] 兑换补发失败', error);
      fail(res, 502, 'SUB2API_GRANT_FAILED', toAdminUpstreamFailureDetail(error));
      return;
    }
    console.error('[admin] 兑换补发失败', error);
    fail(res, 500, 'REDEEM_RETRY_FAILED', '补发失败，请稍后重试');
  }
}));

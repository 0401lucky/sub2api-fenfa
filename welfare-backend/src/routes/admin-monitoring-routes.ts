import { Router } from 'express';
import { z } from 'zod';
import {
  distributionDetectionService,
  RiskConflictError,
  RiskNotFoundError
} from '../services/distribution-detection-service.js';
import {
  monitoringService,
  MonitoringConflictError,
  MonitoringFeatureUnavailableError,
  MonitoringNotFoundError,
  MonitoringUpstreamError
} from '../services/monitoring-service.js';
import { fail, ok } from '../utils/response.js';
import { asyncHandler } from '../utils/async-handler.js';

function toRuleHitsPayload(item: Array<{
  code: string;
  label: string;
  level: string;
  window: string;
  actual: number;
  threshold: number;
  score: number;
}>) {
  return item.map((hit) => ({
    code: hit.code,
    label: hit.label,
    level: hit.level,
    window: hit.window,
    actual: hit.actual,
    threshold: hit.threshold,
    score: hit.score
  }));
}

function toMonitoringActionPayload(item: Awaited<ReturnType<typeof monitoringService.listActions>>['items'][number]) {
  return {
    id: item.id,
    action_type: item.actionType,
    target_type: item.targetType,
    target_id: item.targetId,
    target_label: item.targetLabel,
    operator_sub2api_user_id: item.operatorSub2apiUserId,
    operator_email: item.operatorEmail,
    operator_username: item.operatorUsername,
    reason: item.reason,
    result_status: item.resultStatus,
    detail: item.detail,
    metadata: item.metadata,
    created_at: item.createdAt
  };
}

function toMonitoringOverviewPayload(overview: Awaited<ReturnType<typeof monitoringService.getOverview>>) {
  return {
    generated_at: overview.generatedAt,
    thresholds: {
      observe_ip_count: overview.thresholds.observeIpCount,
      block_ip_count: overview.thresholds.blockIpCount,
      lock_duration_ms: overview.thresholds.lockDurationMs,
      live_cache_ttl_ms: overview.thresholds.liveCacheTtlMs,
      snapshot_interval_ms: overview.thresholds.snapshotIntervalMs
    },
    summary: {
      raw_request_count_24h: overview.summary.rawRequestCount24h,
      request_count_24h: overview.summary.requestCount24h,
      excluded_request_count_24h: overview.summary.excludedCount24h,
      active_user_count_24h: overview.summary.activeUserCount24h,
      unique_ip_count_24h: overview.summary.uniqueIpCount24h,
      observe_user_count_1h: overview.summary.observeUserCount1h,
      blocked_user_count: overview.summary.blockedUserCount,
      pending_release_count: overview.summary.pendingReleaseCount,
      shared_ip_count_1h: overview.summary.sharedIpCount1h,
      shared_ip_count_24h: overview.summary.sharedIpCount24h
    },
    excluded_breakdown: {
      invalid_created_at: overview.excludedBreakdown.invalidCreatedAt,
      missing_user_id: overview.excludedBreakdown.missingUserId,
      missing_ip_address: overview.excludedBreakdown.missingIpAddress,
      outside_window: overview.excludedBreakdown.outsideWindow
    },
    windows: {
      observe_user_count_1h: overview.windows.observeUserCount1h,
      observe_user_count_24h: overview.windows.observeUserCount24h,
      shared_user_count_24h: overview.windows.sharedUserCount24h,
      shared_ip_count_1h: overview.windows.sharedIpCount1h,
      shared_ip_count_24h: overview.windows.sharedIpCount24h
    },
    usage_sync: {
      last_started_at: overview.usageSyncState.lastStartedAt,
      last_finished_at: overview.usageSyncState.lastFinishedAt,
      last_status: overview.usageSyncState.lastStatus,
      last_error: overview.usageSyncState.lastError,
      fetched_page_count: overview.usageSyncState.fetchedPageCount,
      upserted_count: overview.usageSyncState.upsertedCount,
      updated_at: overview.usageSyncState.updatedAt
    },
    last_scan: {
      last_started_at: overview.lastScan.lastStartedAt,
      last_finished_at: overview.lastScan.lastFinishedAt,
      last_status: overview.lastScan.lastStatus,
      last_error: overview.lastScan.lastError,
      last_trigger_source: overview.lastScan.lastTriggerSource,
      scanned_user_count: overview.lastScan.scannedUserCount,
      hit_user_count: overview.lastScan.hitUserCount,
      updated_at: overview.lastScan.updatedAt
    },
    snapshot_points: overview.snapshotPoints.map((item) => ({
      snapshot_at: item.snapshotAt,
      raw_request_count_24h: item.rawRequestCount24h,
      request_count_24h: item.requestCount24h,
      active_user_count_24h: item.activeUserCount24h,
      unique_ip_count_24h: item.uniqueIpCount24h,
      observe_user_count_1h: item.observeUserCount1h,
      blocked_user_count: item.blockedUserCount,
      pending_release_count: item.pendingReleaseCount,
      shared_ip_count_1h: item.sharedIpCount1h,
      shared_ip_count_24h: item.sharedIpCount24h
    })),
    recent_actions: overview.recentActions.map((item) => toMonitoringActionPayload(item))
  };
}

function toMonitoringIpPayload(item: Awaited<ReturnType<typeof monitoringService.listIps>>['items'][number]) {
  return {
    ip_address: item.ipAddress,
    request_count_10m: item.requestCount10m,
    request_count_1h: item.requestCount1h,
    request_count_24h: item.requestCount24h,
    user_count_10m: item.userCount10m,
    user_count_1h: item.userCount1h,
    user_count_24h: item.userCount24h,
    first_seen_at: item.firstSeenAt,
    last_seen_at: item.lastSeenAt,
    risk_level: item.riskLevel,
    risk_score: item.riskScore,
    risk_band: item.riskBand,
    rule_hits: toRuleHitsPayload(item.ruleHits),
    sample_users: item.sampleUsers.map((user) => ({
      sub2api_user_id: user.sub2apiUserId,
      sub2api_username: user.sub2apiUsername,
      sub2api_email: user.sub2apiEmail
    }))
  };
}

function toMonitoringIpUserPayload(item: Awaited<ReturnType<typeof monitoringService.getIpUsers>>['users'][number]) {
  return {
    sub2api_user_id: item.sub2apiUserId,
    sub2api_email: item.sub2apiEmail,
    sub2api_username: item.sub2apiUsername,
    linuxdo_subject: item.linuxdoSubject,
    sub2api_role: item.sub2apiRole,
    sub2api_status: item.sub2apiStatus,
    is_admin_protected: item.isAdminProtected,
    risk_status: item.riskStatus,
    risk_event_id: item.riskEventId,
    request_count_1h: item.requestCount1h,
    request_count_24h: item.requestCount24h,
    unique_ip_count_1h: item.uniqueIpCount1h,
    unique_ip_count_24h: item.uniqueIpCount24h,
    risk_score: item.riskScore,
    risk_band: item.riskBand,
    rule_hits: toRuleHitsPayload(item.ruleHits),
    first_seen_at: item.firstSeenAt,
    last_seen_at: item.lastSeenAt
  };
}

function toMonitoringUserPayload(item: Awaited<ReturnType<typeof monitoringService.listUsers>>['items'][number]) {
  return {
    sub2api_user_id: item.sub2apiUserId,
    sub2api_email: item.sub2apiEmail,
    sub2api_username: item.sub2apiUsername,
    linuxdo_subject: item.linuxdoSubject,
    sub2api_role: item.sub2apiRole,
    sub2api_status: item.sub2apiStatus,
    is_admin_protected: item.isAdminProtected,
    risk_status: item.riskStatus,
    risk_event_id: item.riskEventId,
    request_count_1h: item.requestCount1h,
    request_count_24h: item.requestCount24h,
    unique_ip_count_1h: item.uniqueIpCount1h,
    unique_ip_count_24h: item.uniqueIpCount24h,
    risk_score: item.riskScore,
    risk_band: item.riskBand,
    rule_hits: toRuleHitsPayload(item.ruleHits),
    first_seen_at: item.firstSeenAt,
    last_seen_at: item.lastSeenAt
  };
}

function toMonitoringUserIpPayload(item: Awaited<ReturnType<typeof monitoringService.getUserIps>>['ips'][number]) {
  return {
    ip_address: item.ipAddress,
    request_count_1h: item.requestCount1h,
    request_count_24h: item.requestCount24h,
    shared_user_count_24h: item.sharedUserCount24h,
    first_seen_at: item.firstSeenAt,
    last_seen_at: item.lastSeenAt
  };
}

function toMonitoringIpCloudflarePayload(
  item: Awaited<ReturnType<typeof monitoringService.getIpCloudflareStatus>>
) {
  return {
    ip_address: item.ipAddress,
    enabled: item.enabled,
    can_manage: item.canManage,
    disabled_reason: item.disabledReason,
    matched_rule_count: item.matchedRuleCount,
    rule: item.rule
      ? {
          id: item.rule.id,
          mode: item.rule.mode,
          source: item.rule.source,
          notes: item.rule.notes,
          created_at: item.rule.createdAt,
          modified_at: item.rule.modifiedAt
        }
      : null
  };
}

function toAdminRiskOverviewPayload(overview: Awaited<ReturnType<typeof distributionDetectionService.getOverview>>) {
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
      scanned_user_count: overview.lastScan.scannedUserCount,
      hit_user_count: overview.lastScan.hitUserCount,
      updated_at: overview.lastScan.updatedAt
    }
  };
}

function toAdminRiskObservationPayload(item: Awaited<ReturnType<typeof distributionDetectionService.listObservations>>['items'][number]) {
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
    risk_score: item.riskScore,
    risk_band: item.riskBand,
    rule_hits: toRuleHitsPayload(item.ruleHits),
    first_hit_at: item.firstHitAt,
    last_hit_at: item.lastHitAt
  };
}

function toAdminRiskEventPayload(item: Awaited<ReturnType<typeof distributionDetectionService.listEvents>>['items'][number]) {
  return {
    id: item.id,
    sub2apiUserId: item.sub2apiUserId,
    sub2apiEmail: item.sub2apiEmail,
    sub2apiUsername: item.sub2apiUsername,
    linuxdoSubject: item.linuxdoSubject,
    sub2apiRole: item.sub2apiRole,
    sub2apiStatus: item.sub2apiStatus,
    status: item.status,
    windowStartedAt: item.windowStartedAt,
    windowEndedAt: item.windowEndedAt,
    distinctIpCount: item.distinctIpCount,
    ipSamples: item.ipSamples,
    riskScore: item.riskScore,
    riskBand: item.riskBand,
    ruleHits: toRuleHitsPayload(item.ruleHits),
    firstHitAt: item.firstHitAt,
    lastHitAt: item.lastHitAt,
    minimumLockUntil: item.minimumLockUntil,
    mainSiteSyncStatus: item.mainSiteSyncStatus,
    mainSiteSyncError: item.mainSiteSyncError,
    lastScanStatus: item.lastScanStatus,
    lastScanError: item.lastScanError,
    lastScanSource: item.lastScanSource,
    lastScannedAt: item.lastScannedAt,
    releasedBySub2apiUserId: item.releasedBySub2apiUserId,
    releasedByEmail: item.releasedByEmail,
    releasedByUsername: item.releasedByUsername,
    releaseReason: item.releaseReason,
    releasedAt: item.releasedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

const pagingSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(200).optional()
});

const monitoringIpQuerySchema = pagingSchema.extend({
  search: z.string().trim().max(200).optional()
});

const monitoringActionQuerySchema = pagingSchema.extend({
  action_type: z
    .enum([
      'disable_user',
      'enable_user',
      'release_risk_event',
      'run_risk_scan',
      'cloudflare_challenge_ip',
      'cloudflare_block_ip',
      'cloudflare_unblock_ip'
    ])
    .optional()
});

const riskEventsQuerySchema = pagingSchema.extend({
  status: z.enum(['active', 'pending_release', 'released']).optional()
});

const actionReasonSchema = z
  .object({
    reason: z.string().max(500).optional()
  })
  .default({});

export const adminMonitoringRouter = Router();

adminMonitoringRouter.get('/overview', asyncHandler(async (_req, res) => {
  const overview = await monitoringService.getOverview();
  ok(res, toMonitoringOverviewPayload(overview));
}));

adminMonitoringRouter.get('/ips', asyncHandler(async (req, res) => {
  const parsed = monitoringIpQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', '查询参数非法');
    return;
  }

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.page_size ?? 12;
  const search = parsed.data.search?.trim() ?? '';
  const result = await monitoringService.listIps({ page, pageSize, search });
  ok(res, {
    items: result.items.map((item) => toMonitoringIpPayload(item)),
    total: result.total,
    page,
    page_size: pageSize,
    pages: Math.max(1, Math.ceil(result.total / pageSize)),
    generated_at: result.generatedAt,
    search
  });
}));

adminMonitoringRouter.get('/ips/:ip/users', asyncHandler(async (req, res) => {
  try {
    const result = await monitoringService.getIpUsers(req.params.ip);
    ok(res, {
      ip: toMonitoringIpPayload(result.ip),
      items: result.users.map((item) => toMonitoringIpUserPayload(item)),
      total: result.users.length,
      generated_at: result.generatedAt
    });
  } catch (error) {
    if (error instanceof MonitoringNotFoundError) {
      fail(res, 404, 'NOT_FOUND', error.message);
      return;
    }
    throw error;
  }
}));

adminMonitoringRouter.get('/ips/:ip/cloudflare', asyncHandler(async (req, res) => {
  try {
    const result = await monitoringService.getIpCloudflareStatus(req.params.ip);
    ok(res, toMonitoringIpCloudflarePayload(result));
  } catch (error) {
    if (error instanceof MonitoringNotFoundError) {
      fail(res, 404, 'NOT_FOUND', error.message);
      return;
    }
    if (error instanceof MonitoringUpstreamError) {
      fail(res, 502, 'CLOUDFLARE_UPSTREAM_ERROR', error.message);
      return;
    }
    throw error;
  }
}));

adminMonitoringRouter.get('/ips/:ip/detail', asyncHandler(async (req, res) => {
  try {
    const result = await monitoringService.getIpDetailView(req.params.ip);
    ok(res, {
      ip: toMonitoringIpPayload(result.ip),
      items: result.users.map((item) => toMonitoringIpUserPayload(item)),
      total: result.users.length,
      cloudflare: toMonitoringIpCloudflarePayload(result.cloudflare),
      recent_actions: result.recentActions.map((item) => toMonitoringActionPayload(item)),
      generated_at: result.generatedAt
    });
  } catch (error) {
    if (error instanceof MonitoringNotFoundError) {
      fail(res, 404, 'NOT_FOUND', error.message);
      return;
    }
    if (error instanceof MonitoringUpstreamError) {
      fail(res, 502, 'CLOUDFLARE_UPSTREAM_ERROR', error.message);
      return;
    }
    throw error;
  }
}));

adminMonitoringRouter.get('/users', asyncHandler(async (req, res) => {
  const parsed = pagingSchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', '查询参数非法');
    return;
  }

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.page_size ?? 12;
  const result = await monitoringService.listUsers({ page, pageSize });
  ok(res, {
    items: result.items.map((item) => toMonitoringUserPayload(item)),
    total: result.total,
    page,
    page_size: pageSize,
    pages: Math.max(1, Math.ceil(result.total / pageSize)),
    generated_at: result.generatedAt
  });
}));

adminMonitoringRouter.get('/users/:id/ips', asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    fail(res, 400, 'BAD_REQUEST', 'id 非法');
    return;
  }

  try {
    const result = await monitoringService.getUserIps(userId);
    ok(res, {
      user: toMonitoringUserPayload(result.user),
      items: result.ips.map((item) => toMonitoringUserIpPayload(item)),
      total: result.ips.length,
      generated_at: result.generatedAt
    });
  } catch (error) {
    if (error instanceof MonitoringNotFoundError) {
      fail(res, 404, 'NOT_FOUND', error.message);
      return;
    }
    throw error;
  }
}));

adminMonitoringRouter.get('/users/:id/detail', asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    fail(res, 400, 'BAD_REQUEST', 'id 非法');
    return;
  }

  try {
    const result = await monitoringService.getUserDetailView(userId);
    ok(res, {
      user: toMonitoringUserPayload(result.user),
      items: result.ips.map((item) => toMonitoringUserIpPayload(item)),
      total: result.ips.length,
      open_risk_event: result.openRiskEvent ? toAdminRiskEventPayload(result.openRiskEvent) : null,
      recent_actions: result.recentActions.map((item) => toMonitoringActionPayload(item)),
      generated_at: result.generatedAt
    });
  } catch (error) {
    if (error instanceof MonitoringNotFoundError) {
      fail(res, 404, 'NOT_FOUND', error.message);
      return;
    }
    throw error;
  }
}));

adminMonitoringRouter.post('/users/:id/disable', asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    fail(res, 400, 'BAD_REQUEST', 'id 非法');
    return;
  }

  const parsed = actionReasonSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? '参数非法');
    return;
  }

  try {
    const item = await monitoringService.disableUser(
      userId,
      req.sessionUser!,
      parsed.data.reason?.trim() ?? ''
    );
    ok(res, {
      item: {
        id: item.id,
        email: item.email,
        username: item.username || item.email,
        role: item.role || 'user',
        status: item.status || 'disabled'
      }
    });
  } catch (error) {
    if (error instanceof MonitoringNotFoundError) {
      fail(res, 404, 'NOT_FOUND', error.message);
      return;
    }
    if (error instanceof MonitoringConflictError) {
      fail(res, 409, 'MONITORING_CONFLICT', error.message);
      return;
    }
    throw error;
  }
}));

adminMonitoringRouter.post('/users/:id/enable', asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    fail(res, 400, 'BAD_REQUEST', 'id 非法');
    return;
  }

  const parsed = actionReasonSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? '参数非法');
    return;
  }

  try {
    const item = await monitoringService.enableUser(
      userId,
      req.sessionUser!,
      parsed.data.reason?.trim() ?? ''
    );
    ok(res, {
      item: {
        id: item.id,
        email: item.email,
        username: item.username || item.email,
        role: item.role || 'user',
        status: item.status || 'active'
      }
    });
  } catch (error) {
    if (error instanceof MonitoringNotFoundError) {
      fail(res, 404, 'NOT_FOUND', error.message);
      return;
    }
    if (error instanceof MonitoringConflictError) {
      fail(res, 409, 'MONITORING_CONFLICT', error.message);
      return;
    }
    throw error;
  }
}));

adminMonitoringRouter.post('/ips/:ip/challenge', asyncHandler(async (req, res) => {
  const parsed = actionReasonSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? '参数非法');
    return;
  }

  try {
    const item = await monitoringService.challengeIp(
      req.params.ip,
      req.sessionUser!,
      parsed.data.reason?.trim() ?? ''
    );
    ok(res, {
      item: toMonitoringIpCloudflarePayload(item)
    });
  } catch (error) {
    if (error instanceof MonitoringNotFoundError) {
      fail(res, 404, 'NOT_FOUND', error.message);
      return;
    }
    if (error instanceof MonitoringConflictError) {
      fail(res, 409, 'MONITORING_CONFLICT', error.message);
      return;
    }
    if (error instanceof MonitoringFeatureUnavailableError) {
      fail(res, 503, 'CLOUDFLARE_NOT_CONFIGURED', error.message);
      return;
    }
    if (error instanceof MonitoringUpstreamError) {
      fail(res, 502, 'CLOUDFLARE_UPSTREAM_ERROR', error.message);
      return;
    }
    throw error;
  }
}));

adminMonitoringRouter.post('/ips/:ip/block', asyncHandler(async (req, res) => {
  const parsed = actionReasonSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? '参数非法');
    return;
  }

  try {
    const item = await monitoringService.blockIp(
      req.params.ip,
      req.sessionUser!,
      parsed.data.reason?.trim() ?? ''
    );
    ok(res, {
      item: toMonitoringIpCloudflarePayload(item)
    });
  } catch (error) {
    if (error instanceof MonitoringNotFoundError) {
      fail(res, 404, 'NOT_FOUND', error.message);
      return;
    }
    if (error instanceof MonitoringConflictError) {
      fail(res, 409, 'MONITORING_CONFLICT', error.message);
      return;
    }
    if (error instanceof MonitoringFeatureUnavailableError) {
      fail(res, 503, 'CLOUDFLARE_NOT_CONFIGURED', error.message);
      return;
    }
    if (error instanceof MonitoringUpstreamError) {
      fail(res, 502, 'CLOUDFLARE_UPSTREAM_ERROR', error.message);
      return;
    }
    throw error;
  }
}));

adminMonitoringRouter.delete('/ips/:ip/cloudflare', asyncHandler(async (req, res) => {
  const parsed = actionReasonSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? '参数非法');
    return;
  }

  try {
    const item = await monitoringService.unblockIp(
      req.params.ip,
      req.sessionUser!,
      parsed.data.reason?.trim() ?? ''
    );
    ok(res, {
      item: toMonitoringIpCloudflarePayload(item)
    });
  } catch (error) {
    if (error instanceof MonitoringNotFoundError) {
      fail(res, 404, 'NOT_FOUND', error.message);
      return;
    }
    if (error instanceof MonitoringConflictError) {
      fail(res, 409, 'MONITORING_CONFLICT', error.message);
      return;
    }
    if (error instanceof MonitoringFeatureUnavailableError) {
      fail(res, 503, 'CLOUDFLARE_NOT_CONFIGURED', error.message);
      return;
    }
    if (error instanceof MonitoringUpstreamError) {
      fail(res, 502, 'CLOUDFLARE_UPSTREAM_ERROR', error.message);
      return;
    }
    throw error;
  }
}));

adminMonitoringRouter.get('/actions', asyncHandler(async (req, res) => {
  const parsed = monitoringActionQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', '查询参数非法');
    return;
  }

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.page_size ?? 12;
  const result = await monitoringService.listActions({
    page,
    pageSize,
    actionType: parsed.data.action_type
  });
  ok(res, {
    items: result.items.map((item) => toMonitoringActionPayload(item)),
    total: result.total,
    page,
    page_size: pageSize,
    pages: Math.max(1, Math.ceil(result.total / pageSize))
  });
}));

adminMonitoringRouter.get('/risk-events/overview', asyncHandler(async (_req, res) => {
  const overview = await distributionDetectionService.getOverview();
  ok(res, toAdminRiskOverviewPayload(overview));
}));

adminMonitoringRouter.get('/risk-events/observations', asyncHandler(async (req, res) => {
  const parsed = pagingSchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'BAD_REQUEST', '查询参数非法');
    return;
  }

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.page_size ?? 20;
  const result = await distributionDetectionService.listObservations({ page, pageSize });
  ok(res, {
    items: result.items.map((item) => toAdminRiskObservationPayload(item)),
    total: result.total,
    page,
    page_size: pageSize,
    pages: Math.max(1, Math.ceil(result.total / pageSize))
  });
}));

adminMonitoringRouter.get('/risk-events', asyncHandler(async (req, res) => {
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

adminMonitoringRouter.post('/risk-events/scan', asyncHandler(async (req, res) => {
  try {
    const result = await distributionDetectionService.runBatchScan('manual');
    await monitoringService.recordRiskScanAction(req.sessionUser!, {
      matchedUserCount: result.matchedUserCount,
      createdEventCount: result.createdEventCount,
      refreshedEventCount: result.refreshedEventCount,
      status: 'success',
      detail: `手动扫描完成，命中 ${result.matchedUserCount} 人`
    });
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
  } catch (error) {
    await monitoringService.recordRiskScanAction(req.sessionUser!, {
      matchedUserCount: 0,
      createdEventCount: 0,
      refreshedEventCount: 0,
      status: 'failed',
      detail: error instanceof Error ? error.message : '手动扫描失败'
    });
    throw error;
  }
}));

adminMonitoringRouter.post('/risk-events/:id/release', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, 'BAD_REQUEST', 'id 非法');
    return;
  }

  const parsed = actionReasonSchema.safeParse(req.body);
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
    await monitoringService.recordRiskReleaseAction(req.sessionUser!, {
      eventId: item.id,
      userId: item.sub2apiUserId,
      targetLabel: item.sub2apiUsername || item.sub2apiEmail,
      reason: parsed.data.reason?.trim() ?? ''
    });
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
    throw error;
  }
}));

import { config } from '../config.js';
import { pool } from '../db.js';
import { RiskRepository, type SaveRiskEventInput } from '../repositories/risk-repository.js';
import { WelfareRepository } from '../repositories/welfare-repository.js';
import type {
  RiskBand,
  RiskEvent,
  RiskEventStatus,
  RiskRuleHit,
  RiskScanState,
  SessionUser
} from '../types/domain.js';
import { extractLinuxDoSubjectFromEmail } from '../utils/oauth.js';
import { sessionStateService, SessionStateService } from './session-state-service.js';
import { sub2apiClient, Sub2apiClient, type AdminUserRecord } from './sub2api-client.js';
import { buildUserRuleHits, riskBandFromScore, scoreRiskHits } from './monitoring-rules.js';
import { usageAnalysisService, type EffectiveUsageEntry, type UsageAnalysisService } from './usage-analysis-service.js';

export const DISTRIBUTION_WINDOW_MS = 60 * 60 * 1000;
export const DISTRIBUTION_OBSERVE_IP_THRESHOLD = config.WELFARE_MONITOR_OBSERVE_IP_THRESHOLD;
export const DISTRIBUTION_BAN_IP_THRESHOLD = config.WELFARE_MONITOR_BLOCK_IP_THRESHOLD;
export const DISTRIBUTION_IP_THRESHOLD = DISTRIBUTION_BAN_IP_THRESHOLD;
export const DISTRIBUTION_MINIMUM_LOCK_MS = config.WELFARE_MONITOR_LOCK_DURATION_MS;
export const DISTRIBUTION_SCAN_INTERVAL_MS = config.WELFARE_MONITOR_SCAN_INTERVAL_MS;
export const DISTRIBUTION_WINDOW_STATS = {
  window1h: 1 * 60 * 60 * 1000,
  window3h: 3 * 60 * 60 * 1000,
  window6h: 6 * 60 * 60 * 1000,
  window24h: 24 * 60 * 60 * 1000
} as const;

const MAX_IP_SAMPLE_COUNT = 10;

type ScanSource = 'scheduled' | 'manual' | 'auth';

interface LoggerLike {
  info(message: string): void;
  error(message: string, error?: unknown): void;
  warn?(message: string, error?: unknown): void;
}

interface RiskIdentity {
  sub2apiUserId: number;
  email: string;
  username: string;
  linuxdoSubject: string | null;
}

interface AdminExemptions {
  userIds: Set<number>;
  subjects: Set<string>;
}

interface DistributionSignal {
  userId: number;
  user: AdminUserRecord;
  ipSamples: string[];
  distinctIpCount: number;
  riskScore: number;
  riskBand: RiskBand;
  ruleHits: RiskRuleHit[];
  firstHitAt: string;
  lastHitAt: string;
}

export interface RiskOverview {
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
  lastScan: RiskScanState;
}

export interface RiskObservation {
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
  riskScore: number;
  riskBand: RiskBand;
  ruleHits: RiskRuleHit[];
  firstHitAt: string;
  lastHitAt: string;
}

interface ObservationWindowStats {
  window1hIpCount: number;
  window3hIpCount: number;
  window6hIpCount: number;
  window24hIpCount: number;
  ipSamples: string[];
  firstHitAt: string | null;
  lastHitAt: string | null;
}

function createEmptyObservationWindowStats(): ObservationWindowStats {
  return {
    window1hIpCount: 0,
    window3hIpCount: 0,
    window6hIpCount: 0,
    window24hIpCount: 0,
    ipSamples: [],
    firstHitAt: null,
    lastHitAt: null
  };
}

function createEmptyOverviewWindowCounts(): RiskOverview['windows'] {
  return {
    window1hObserveCount: 0,
    window3hObserveCount: 0,
    window6hObserveCount: 0,
    window24hObserveCount: 0
  };
}

export function buildMinimumLockUntil(referenceMs: number): string {
  return new Date(referenceMs + DISTRIBUTION_MINIMUM_LOCK_MS).toISOString();
}

export function summarizeUsageLogs(
  logs: Array<{
    userId: number;
    ipAddress: string | null;
    createdAt: string;
  }>,
  nowMs = Date.now()
): Array<{
  sub2apiUserId: number;
  distinctIpCount: number;
  ipSamples: string[];
  firstHitAt: string;
  lastHitAt: string;
}> {
  const cutoffMs = nowMs - DISTRIBUTION_WINDOW_MS;
  const grouped = new Map<
    number,
    {
      ipSet: Set<string>;
      firstHitAt: string | null;
      lastHitAt: string | null;
    }
  >();

  for (const log of logs) {
    const createdAtMs = Date.parse(log.createdAt);
    const ip = normalizeIp(log.ipAddress);
    if (
      !Number.isInteger(log.userId) ||
      log.userId <= 0 ||
      Number.isNaN(createdAtMs) ||
      createdAtMs < cutoffMs ||
      !ip
    ) {
      continue;
    }

    const current =
      grouped.get(log.userId) ?? {
        ipSet: new Set<string>(),
        firstHitAt: null,
        lastHitAt: null
      };
    current.ipSet.add(ip);
    if (!current.firstHitAt || createdAtMs < Date.parse(current.firstHitAt)) {
      current.firstHitAt = log.createdAt;
    }
    if (!current.lastHitAt || createdAtMs > Date.parse(current.lastHitAt)) {
      current.lastHitAt = log.createdAt;
    }
    grouped.set(log.userId, current);
  }

  return Array.from(grouped.entries()).map(([sub2apiUserId, value]) => ({
    sub2apiUserId,
    distinctIpCount: value.ipSet.size,
    ipSamples: Array.from(value.ipSet).sort(),
    firstHitAt: value.firstHitAt ?? new Date(nowMs).toISOString(),
    lastHitAt: value.lastHitAt ?? new Date(nowMs).toISOString()
  }));
}

function trimErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message.slice(0, 500);
  }

  return 'unknown error';
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeIp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '' ? null : normalized;
}

function normalizeUserRole(value: string | undefined): 'admin' | 'user' {
  return value === 'admin' ? 'admin' : 'user';
}

function normalizeUserStatus(value: string | undefined): string {
  const normalized = (value ?? '').trim();
  return normalized === '' ? 'active' : normalized;
}

function toAdminUserRecord(entry: EffectiveUsageEntry): AdminUserRecord {
  return {
    id: entry.userId,
    email: entry.email,
    username: entry.username,
    role: entry.role,
    status: normalizeUserStatus(entry.status) === 'disabled' ? 'disabled' : 'active'
  };
}

export class RiskAccessDeniedError extends Error {
  constructor(readonly event: RiskEvent, detail: string) {
    super(detail);
    this.name = 'RiskAccessDeniedError';
  }
}

export class RiskNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RiskNotFoundError';
  }
}

export class RiskConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RiskConflictError';
  }
}

type WelfareRepositoryLike = Pick<
  WelfareRepository,
  'hasAdminUserId' | 'hasLegacyAdminSubject' | 'listAdminWhitelist'
>;

type Sub2apiClientLike = Pick<
  Sub2apiClient,
  'getAdminUserById' | 'updateAdminUserStatus'
>;

type UsageAnalysisServiceLike = Pick<UsageAnalysisService, 'getSnapshot'>;

export class DistributionDetectionService {
  private runningScan: Promise<{
    scannedLogCount: number;
    matchedUserCount: number;
    createdEventCount: number;
    refreshedEventCount: number;
    skippedAdminCount: number;
    retriedMainSiteCount: number;
    lastScan: RiskScanState;
    startedAt: string;
    finishedAt: string;
  }> | null = null;

  constructor(
    private readonly repository: RiskRepository,
    private readonly sessionState: Pick<
      SessionStateService,
      'bumpSessionVersion' | 'getSessionVersion'
    >,
    private readonly sub2api: Sub2apiClientLike,
    private readonly welfare: WelfareRepositoryLike,
    private readonly logger: LoggerLike,
    private readonly usageAnalysis: UsageAnalysisServiceLike = usageAnalysisService
  ) {}

  startScanLoop(intervalMs = DISTRIBUTION_SCAN_INTERVAL_MS): NodeJS.Timeout {
    const run = async () => {
      try {
        await this.runBatchScan('scheduled');
      } catch (error) {
        this.logger.error('[risk] 定时分发扫描失败', error);
      }
    };

    void run();
    const timer = setInterval(() => {
      void run();
    }, intervalMs);
    timer.unref?.();
    return timer;
  }

  getBlockedDetail(event: RiskEvent): string {
    if (event.status === 'pending_release') {
      return '账号因疑似分发已被封禁，当前处于待人工恢复状态';
    }

    return '账号因疑似分发已被封禁，至少锁定 24 小时';
  }

  async evaluateAccess(
    identity: RiskIdentity,
    source: string
  ): Promise<{ blockedEvent: RiskEvent | null; sessionInvalidated: boolean }> {
    if (await this.isWelfareAdmin(identity.sub2apiUserId, identity.linuxdoSubject)) {
      return {
        blockedEvent: null,
        sessionInvalidated: false
      };
    }

    await this.repository.syncExpiredEvents(nowIso(), undefined, identity.sub2apiUserId);

    const existing = await this.repository.getBlockingEventByUserId(identity.sub2apiUserId);
    if (existing) {
      return {
        blockedEvent: existing,
        sessionInvalidated: false
      };
    }

    const sessionVersionBefore = await this.sessionState.getSessionVersion(
      identity.sub2apiUserId
    );
    const [user, whitelist] = await Promise.all([
      this.sub2api.getAdminUserById(identity.sub2apiUserId),
      this.welfare.listAdminWhitelist()
    ]);

    if (!user || this.isExemptUser(user, whitelist)) {
      return {
        blockedEvent: null,
        sessionInvalidated: false
      };
    }

    const event = await this.scanSingleUser(
      identity.sub2apiUserId,
      user,
      whitelist,
      source
    );
    if (!event) {
      return {
        blockedEvent: null,
        sessionInvalidated: false
      };
    }

    const sessionVersionAfter = await this.sessionState.getSessionVersion(
      identity.sub2apiUserId
    );
    return {
      blockedEvent: event,
      sessionInvalidated: sessionVersionAfter !== sessionVersionBefore
    };
  }

  async assertAccessAllowed(
    identity: number | RiskIdentity,
    options: {
      source: string;
      recheck: boolean;
    }
  ): Promise<void> {
    const normalizedIdentity: RiskIdentity =
      typeof identity === 'number'
        ? {
            sub2apiUserId: identity,
            email: '',
            username: '',
            linuxdoSubject: null
          }
        : identity;

    if (
      await this.isWelfareAdmin(
        normalizedIdentity.sub2apiUserId,
        normalizedIdentity.linuxdoSubject
      )
    ) {
      return;
    }

    await this.repository.syncExpiredEvents(nowIso(), undefined, normalizedIdentity.sub2apiUserId);

    const existing = await this.repository.getBlockingEventByUserId(
      normalizedIdentity.sub2apiUserId
    );
    if (existing) {
      throw new RiskAccessDeniedError(existing, this.getBlockedDetail(existing));
    }

    if (!options.recheck) {
      return;
    }

    const [user, whitelist] = await Promise.all([
      this.sub2api.getAdminUserById(normalizedIdentity.sub2apiUserId),
      this.welfare.listAdminWhitelist()
    ]);

    if (!user) {
      return;
    }

    if (this.isExemptUser(user, whitelist)) {
      return;
    }

    const event = await this.scanSingleUser(
      normalizedIdentity.sub2apiUserId,
      user,
      whitelist,
      options.source
    );
    if (event) {
      throw new RiskAccessDeniedError(event, this.getBlockedDetail(event));
    }
  }

  async getOverview(): Promise<RiskOverview> {
    await this.repository.syncExpiredEvents(nowIso());
    await this.syncAllOpenRiskEventStatuses();
    const [counts, lastScan, observationSummary] = await Promise.all([
      this.repository.getRiskEventCounts(),
      this.repository.getRiskScanState(),
      this.getObservationSummary()
    ]);

    return {
      activeEventCount: counts.active,
      pendingReleaseCount: counts.pending_release,
      openEventCount: counts.active + counts.pending_release,
      observeCount1h: observationSummary.observeCount1h,
      windows: observationSummary.windows,
      lastScan
    };
  }

  async listEvents(params: {
    page: number;
    pageSize: number;
    status?: RiskEventStatus;
  }): Promise<{ items: RiskEvent[]; total: number }> {
    await this.repository.syncExpiredEvents(nowIso());
    await this.syncAllOpenRiskEventStatuses();
    const result = await this.repository.listRiskEvents(params);
    return {
      items: result.items,
      total: result.total
    };
  }

  async listObservations(params: {
    page: number;
    pageSize: number;
  }): Promise<{ items: RiskObservation[]; total: number }> {
    const observations = (await this.listObservationCandidates()).filter(
      (item) =>
        item.window1hIpCount >= DISTRIBUTION_OBSERVE_IP_THRESHOLD &&
        item.window1hIpCount < DISTRIBUTION_BAN_IP_THRESHOLD
    );
    const sorted = observations.sort((left, right) => {
      if (right.window1hIpCount !== left.window1hIpCount) {
        return right.window1hIpCount - left.window1hIpCount;
      }
      return Date.parse(right.lastHitAt) - Date.parse(left.lastHitAt);
    });
    const offset = (params.page - 1) * params.pageSize;
    return {
      items: sorted.slice(offset, offset + params.pageSize),
      total: sorted.length
    };
  }

  async runBatchScan(source: Exclude<ScanSource, 'auth'>) {
    if (this.runningScan) {
      return this.runningScan;
    }

    const execution = this.runBatchScanInternal(source).finally(() => {
      if (this.runningScan === execution) {
        this.runningScan = null;
      }
    });
    this.runningScan = execution;
    return execution;
  }

  async releaseEvent(
    eventId: number,
    operator: {
      sub2apiUserId: number;
      email: string;
      username: string;
    },
    releaseReason: string
  ): Promise<RiskEvent> {
    const releaseAt = nowIso();
    await this.repository.syncExpiredEvents(releaseAt);

    const existing = await this.repository.getRiskEventById(eventId);
    if (!existing) {
      throw new RiskNotFoundError('风险事件不存在');
    }

    if (existing.status === 'released') {
      throw new RiskConflictError('该风险事件已恢复');
    }

    if (existing.status !== 'pending_release') {
      throw new RiskConflictError('当前事件还未进入待人工恢复状态');
    }

    const updatedUser = await this.sub2api.updateAdminUserStatus(
      existing.sub2apiUserId,
      'active'
    );

    return this.repository.releaseRiskEvent(existing.id, {
      releasedAt: releaseAt,
      releasedBySub2apiUserId: operator.sub2apiUserId,
      releasedByEmail: operator.email,
      releasedByUsername: operator.username,
      releaseReason: releaseReason.trim(),
      sub2apiStatus: normalizeUserStatus(updatedUser.status),
      mainSiteSyncStatus: 'success',
      mainSiteSyncError: ''
    });
  }

  private async runBatchScanInternal(source: Exclude<ScanSource, 'auth'>) {
    const startedAt = nowIso();
    await this.repository.syncExpiredEvents(startedAt);
    await this.repository.markRiskScanStarted(source, startedAt);

    try {
      const [usageEntries, whitelist] = await Promise.all([
        this.listUsageEntries({ windowMs: DISTRIBUTION_WINDOW_MS }),
        this.welfare.listAdminWhitelist()
      ]);
      const signals = this.extractSignalsFromEntries(usageEntries, whitelist);

      let createdEventCount = 0;
      let refreshedEventCount = 0;
      let retriedMainSiteCount = 0;

      for (const signal of signals) {
        const result = await this.lockUserForDistribution(signal, source);
        if (result.created) {
          createdEventCount += 1;
        } else {
          refreshedEventCount += 1;
        }
        if (result.retriedMainSite) {
          retriedMainSiteCount += 1;
        }
      }

      const finishedAt = nowIso();
      await this.repository.markRiskScanFinished({
        status: 'success',
        source,
        finishedAt,
        error: '',
        scannedUserCount: usageEntries.length,
        hitUserCount: signals.length
      });
      const lastScan = await this.repository.getRiskScanState();

      return {
        scannedLogCount: usageEntries.length,
        matchedUserCount: signals.length,
        createdEventCount,
        refreshedEventCount,
        skippedAdminCount: 0,
        retriedMainSiteCount,
        lastScan,
        startedAt,
        finishedAt
      };
    } catch (error) {
      const finishedAt = nowIso();
      await this.repository.markRiskScanFinished({
        status: 'failed',
        source,
        finishedAt,
        error: trimErrorMessage(error),
        scannedUserCount: 0,
        hitUserCount: 0
      });
      throw error;
    }
  }

  private async scanSingleUser(
    sub2apiUserId: number,
    user: AdminUserRecord,
    whitelist: Awaited<ReturnType<WelfareRepositoryLike['listAdminWhitelist']>>,
    source: string
  ): Promise<RiskEvent | null> {
    const usageEntries = await this.listUsageEntries({
      userId: sub2apiUserId,
      windowMs: DISTRIBUTION_WINDOW_MS
    });
    const signals = this.extractSignalsFromEntries(usageEntries, whitelist, user);
    const signal = signals.find((item) => item.userId === sub2apiUserId);
    if (!signal) {
      return null;
    }

    const result = await this.lockUserForDistribution(signal, source);
    return result.event;
  }

  private async listUsageEntries(params: {
    userId?: number;
    windowMs?: number;
  }): Promise<EffectiveUsageEntry[]> {
    const nowMs = Date.now();
    const windowMs = params.windowMs ?? DISTRIBUTION_WINDOW_MS;
    const cutoffMs = nowMs - windowMs;
    const snapshot = await this.usageAnalysis.getSnapshot();

    return snapshot.entries.filter(
      (entry) =>
        entry.createdAtMs >= cutoffMs &&
        entry.createdAtMs <= nowMs &&
        (params.userId == null || entry.userId === params.userId)
    );
  }

  private extractSignalsFromEntries(
    usageEntries: EffectiveUsageEntry[],
    whitelist: Awaited<ReturnType<WelfareRepositoryLike['listAdminWhitelist']>>,
    fallbackUser?: AdminUserRecord
  ): DistributionSignal[] {
    const grouped = new Map<
      number,
      {
        user: AdminUserRecord;
        ipSet: Set<string>;
        firstHitAt: string | null;
        lastHitAt: string | null;
      }
    >();

    for (const entry of usageEntries) {
      const target =
        grouped.get(entry.userId) ??
        {
          user:
            fallbackUser?.id === entry.userId ? fallbackUser : toAdminUserRecord(entry),
          ipSet: new Set<string>(),
          firstHitAt: null,
          lastHitAt: null
        };

      target.ipSet.add(entry.ipAddress);

      if (!target.firstHitAt || entry.createdAtMs < Date.parse(target.firstHitAt)) {
        target.firstHitAt = entry.createdAt;
      }
      if (!target.lastHitAt || entry.createdAtMs > Date.parse(target.lastHitAt)) {
        target.lastHitAt = entry.createdAt;
      }

      grouped.set(entry.userId, target);
    }

    const signals: DistributionSignal[] = [];
    for (const [userId, value] of grouped) {
      const user = value.user;
      if (this.isExemptUser(user, whitelist)) {
        continue;
      }
      const ruleHits = buildUserRuleHits({
        uniqueIpCount1h: value.ipSet.size,
        uniqueIpCount3h: value.ipSet.size,
        uniqueIpCount6h: value.ipSet.size,
        uniqueIpCount24h: value.ipSet.size,
        observeThreshold: DISTRIBUTION_OBSERVE_IP_THRESHOLD,
        blockThreshold: DISTRIBUTION_BAN_IP_THRESHOLD
      });
      const riskScore = scoreRiskHits(ruleHits);
      const riskBand = riskBandFromScore(riskScore);
      if (value.ipSet.size < DISTRIBUTION_BAN_IP_THRESHOLD) {
        continue;
      }

      signals.push({
        userId,
        user,
        ipSamples: Array.from(value.ipSet).sort().slice(0, MAX_IP_SAMPLE_COUNT),
        distinctIpCount: value.ipSet.size,
        riskScore,
        riskBand,
        ruleHits,
        firstHitAt: value.firstHitAt ?? nowIso(),
        lastHitAt: value.lastHitAt ?? nowIso()
      });
    }

    return signals;
  }

  private isExemptUser(
    user: AdminUserRecord,
    whitelist: Awaited<ReturnType<WelfareRepositoryLike['listAdminWhitelist']>>
  ): boolean {
    if (normalizeUserRole(user.role) === 'admin') {
      return true;
    }

    const whitelistUserIds = new Set(
      whitelist
        .map((item) => item.sub2apiUserId)
        .filter((item): item is number => typeof item === 'number' && item > 0)
    );
    if (whitelistUserIds.has(user.id)) {
      return true;
    }

    const whitelistSubjects = new Set(
      whitelist
        .map((item) => item.linuxdoSubject?.trim())
        .filter((item): item is string => Boolean(item))
    );
    const subject = extractLinuxDoSubjectFromEmail(user.email);
    return Boolean(subject && whitelistSubjects.has(subject));
  }

  private async lockUserForDistribution(
    signal: DistributionSignal,
    source: string
  ): Promise<{
    event: RiskEvent;
    created: boolean;
    retriedMainSite: boolean;
  }> {
    const scanAt = nowIso();
    const minimumLockUntil = new Date(Date.now() + DISTRIBUTION_MINIMUM_LOCK_MS).toISOString();

    const transactionResult = await this.repository.withTransaction(async (client) => {
      await this.repository.syncExpiredEvents(scanAt, client);
      const existing = await this.repository.getBlockingEventByUserId(signal.user.id, {
        client,
        forUpdate: true
      });

      const mainSiteSyncStatus: 'success' | 'pending' =
        normalizeUserStatus(signal.user.status) === 'disabled'
          ? 'success'
          : 'pending';

      const saveInput: SaveRiskEventInput = {
        sub2apiUserId: signal.user.id,
        sub2apiEmail: signal.user.email,
        sub2apiUsername: signal.user.username || signal.user.email,
        linuxdoSubject: extractLinuxDoSubjectFromEmail(signal.user.email),
        sub2apiRole: normalizeUserRole(signal.user.role),
        sub2apiStatus: normalizeUserStatus(signal.user.status),
        status: 'active' as const,
        windowStartedAt: new Date(Date.now() - DISTRIBUTION_WINDOW_MS).toISOString(),
        windowEndedAt: scanAt,
        distinctIpCount: signal.distinctIpCount,
        ipSamples: signal.ipSamples,
        riskScore: signal.riskScore,
        riskBand: signal.riskBand,
        ruleHits: signal.ruleHits,
        firstHitAt: signal.firstHitAt,
        lastHitAt: signal.lastHitAt,
        minimumLockUntil,
        mainSiteSyncStatus,
        mainSiteSyncError: '',
        lastScanStatus: 'success' as const,
        lastScanError: '',
        lastScanSource: source,
        lastScannedAt: scanAt
      };

      if (!existing) {
        const created = await this.repository.createBlockingEvent(saveInput, client);
        await this.sessionState.bumpSessionVersion(signal.user.id, client);
        return {
          event: created,
          created: true
        };
      }

      const refreshed = await this.repository.updateBlockingEventFromHit(
        existing.id,
        {
          ...saveInput,
          firstHitAt: existing.firstHitAt
        },
        client
      );
      return {
        event: refreshed,
        created: false
      };
    });

    if (normalizeUserStatus(signal.user.status) === 'disabled') {
      const event = await this.repository.updateRiskEventSync(transactionResult.event.id, {
        sub2apiStatus: 'disabled',
        mainSiteSyncStatus: 'success',
        mainSiteSyncError: ''
      });
      return {
        event,
        created: transactionResult.created,
        retriedMainSite: false
      };
    }

    try {
      const updatedUser = await this.sub2api.updateAdminUserStatus(signal.user.id, 'disabled');
      const event = await this.repository.updateRiskEventSync(transactionResult.event.id, {
        sub2apiStatus: normalizeUserStatus(updatedUser.status),
        mainSiteSyncStatus: 'success',
        mainSiteSyncError: ''
      });
      return {
        event,
        created: transactionResult.created,
        retriedMainSite: true
      };
    } catch (error) {
      const event = await this.repository.updateRiskEventSync(transactionResult.event.id, {
        sub2apiStatus: transactionResult.event.sub2apiStatus,
        mainSiteSyncStatus: 'failed',
        mainSiteSyncError: trimErrorMessage(error)
      });
      this.logger.warn?.(
        `[risk] 主站封禁同步失败: user=${signal.user.id}`,
        error
      );
      return {
        event,
        created: transactionResult.created,
        retriedMainSite: true
      };
    }
  }

  private async listObservationCandidates(): Promise<RiskObservation[]> {
    const whitelist = await this.welfare.listAdminWhitelist();
    const usageEntries = await this.listUsageEntries({
      windowMs: DISTRIBUTION_WINDOW_STATS.window24h
    });
    const grouped = new Map<number, EffectiveUsageEntry[]>();

    usageEntries.forEach((entry) => {
      const current = grouped.get(entry.userId) ?? [];
      current.push(entry);
      grouped.set(entry.userId, current);
    });

    const observations: RiskObservation[] = [];
    for (const [userId, entries] of grouped) {
      const windowStats = this.computeObservationWindowStats(entries);
      if (
        windowStats.window1hIpCount < DISTRIBUTION_OBSERVE_IP_THRESHOLD &&
        windowStats.window3hIpCount < DISTRIBUTION_OBSERVE_IP_THRESHOLD &&
        windowStats.window6hIpCount < DISTRIBUTION_OBSERVE_IP_THRESHOLD &&
        windowStats.window24hIpCount < DISTRIBUTION_OBSERVE_IP_THRESHOLD
      ) {
        continue;
      }

      const snapshot = entries[0];
      const user = snapshot ? toAdminUserRecord(snapshot) : null;
      if (!user || this.isExemptUser(user, whitelist)) {
        continue;
      }

      const ruleHits = buildUserRuleHits({
        uniqueIpCount1h: windowStats.window1hIpCount,
        uniqueIpCount3h: windowStats.window3hIpCount,
        uniqueIpCount6h: windowStats.window6hIpCount,
        uniqueIpCount24h: windowStats.window24hIpCount,
        observeThreshold: DISTRIBUTION_OBSERVE_IP_THRESHOLD,
        blockThreshold: DISTRIBUTION_BAN_IP_THRESHOLD
      });
      const riskScore = scoreRiskHits(ruleHits);
      const riskBand = riskBandFromScore(riskScore);

      observations.push({
        sub2apiUserId: userId,
        sub2apiEmail: user.email,
        sub2apiUsername: user.username || user.email,
        linuxdoSubject: extractLinuxDoSubjectFromEmail(user.email),
        sub2apiRole: normalizeUserRole(user.role),
        sub2apiStatus: normalizeUserStatus(user.status),
        window1hIpCount: windowStats.window1hIpCount,
        window3hIpCount: windowStats.window3hIpCount,
        window6hIpCount: windowStats.window6hIpCount,
        window24hIpCount: windowStats.window24hIpCount,
        ipSamples: windowStats.ipSamples,
        riskScore,
        riskBand,
        ruleHits,
        firstHitAt: windowStats.firstHitAt ?? nowIso(),
        lastHitAt: windowStats.lastHitAt ?? nowIso()
      });
    }

    return observations;
  }

  private async getObservationSummary(): Promise<{
    observeCount1h: number;
    windows: RiskOverview['windows'];
  }> {
    try {
      const observationCandidates = await this.listObservationCandidates();
      const windows = createEmptyOverviewWindowCounts();
      observationCandidates.forEach((item) => {
        if (item.window1hIpCount >= DISTRIBUTION_OBSERVE_IP_THRESHOLD) {
          windows.window1hObserveCount += 1;
        }
        if (item.window3hIpCount >= DISTRIBUTION_OBSERVE_IP_THRESHOLD) {
          windows.window3hObserveCount += 1;
        }
        if (item.window6hIpCount >= DISTRIBUTION_OBSERVE_IP_THRESHOLD) {
          windows.window6hObserveCount += 1;
        }
        if (item.window24hIpCount >= DISTRIBUTION_OBSERVE_IP_THRESHOLD) {
          windows.window24hObserveCount += 1;
        }
      });

      return {
        observeCount1h: observationCandidates.filter(
          (item) =>
            item.window1hIpCount >= DISTRIBUTION_OBSERVE_IP_THRESHOLD &&
            item.window1hIpCount < DISTRIBUTION_BAN_IP_THRESHOLD
        ).length,
        windows
      };
    } catch (error) {
      this.logger.warn?.('[risk] 观察名单统计失败，已降级为空结果', error);
      return {
        observeCount1h: 0,
        windows: createEmptyOverviewWindowCounts()
      };
    }
  }

  private computeObservationWindowStats(
    entries: EffectiveUsageEntry[]
  ): ObservationWindowStats {
    const nowMs = Date.now();
    const oneHourCutoff = nowMs - DISTRIBUTION_WINDOW_STATS.window1h;
    const threeHourCutoff = nowMs - DISTRIBUTION_WINDOW_STATS.window3h;
    const sixHourCutoff = nowMs - DISTRIBUTION_WINDOW_STATS.window6h;
    const twentyFourHourCutoff = nowMs - DISTRIBUTION_WINDOW_STATS.window24h;

    const oneHourIps = new Set<string>();
    const threeHourIps = new Set<string>();
    const sixHourIps = new Set<string>();
    const twentyFourHourIps = new Set<string>();
    let firstHitAt: string | null = null;
    let lastHitAt: string | null = null;

    for (const entry of entries) {
      if (entry.createdAtMs >= twentyFourHourCutoff) {
        twentyFourHourIps.add(entry.ipAddress);
      }
      if (entry.createdAtMs >= sixHourCutoff) {
        sixHourIps.add(entry.ipAddress);
      }
      if (entry.createdAtMs >= threeHourCutoff) {
        threeHourIps.add(entry.ipAddress);
      }
      if (entry.createdAtMs >= oneHourCutoff) {
        oneHourIps.add(entry.ipAddress);
        if (!firstHitAt || entry.createdAtMs < Date.parse(firstHitAt)) {
          firstHitAt = entry.createdAt;
        }
        if (!lastHitAt || entry.createdAtMs > Date.parse(lastHitAt)) {
          lastHitAt = entry.createdAt;
        }
      }
    }

    return {
      window1hIpCount: oneHourIps.size,
      window3hIpCount: threeHourIps.size,
      window6hIpCount: sixHourIps.size,
      window24hIpCount: twentyFourHourIps.size,
      ipSamples: Array.from(oneHourIps).sort().slice(0, MAX_IP_SAMPLE_COUNT),
      firstHitAt,
      lastHitAt
    };
  }

  private async syncRiskEventStatuses(items: RiskEvent[]): Promise<number> {
    let updatedCount = 0;

    for (const item of items) {
      const user = await this.sub2api.getAdminUserById(item.sub2apiUserId);
      if (!user) {
        continue;
      }

      const currentStatus = normalizeUserStatus(user.status);
      if (item.status !== 'released' && currentStatus === 'active') {
        await this.repository.releaseRiskEvent(item.id, {
          sub2apiStatus: 'active',
          mainSiteSyncStatus: 'success',
          mainSiteSyncError: '',
          releasedBySub2apiUserId: 0,
          releasedByEmail: '',
          releasedByUsername: 'system-sync',
          releaseReason: '检测到主站已手动恢复，福利站自动同步释放',
          releasedAt: nowIso()
        });
        updatedCount += 1;
        continue;
      }

      const expectedStatus = item.status === 'released' ? 'active' : 'disabled';
      const nextSyncStatus = currentStatus === expectedStatus ? 'success' : 'failed';
      const nextSyncError =
        nextSyncStatus === 'success'
          ? ''
          : item.status === 'released'
            ? '主站状态仍为 disabled，与已恢复事件不一致'
            : '主站状态已与本地封禁事件不一致';

      if (
        item.sub2apiStatus === currentStatus &&
        item.mainSiteSyncStatus === nextSyncStatus &&
        item.mainSiteSyncError === nextSyncError
      ) {
        continue;
      }

      await this.repository.updateRiskEventSync(item.id, {
        sub2apiStatus: currentStatus,
        mainSiteSyncStatus: nextSyncStatus,
        mainSiteSyncError: nextSyncError
      });
      updatedCount += 1;
    }

    return updatedCount;
  }

  private async syncAllOpenRiskEventStatuses(): Promise<number> {
    const items = await this.repository.listRiskEventsForStatuses(
      ['active', 'pending_release'],
      1000
    );
    return this.syncRiskEventStatuses(items);
  }

  private async isWelfareAdmin(
    sub2apiUserId: number,
    linuxdoSubject: string | null
  ): Promise<boolean> {
    const [byUserId, bySubject] = await Promise.all([
      this.welfare.hasAdminUserId(sub2apiUserId),
      linuxdoSubject
        ? this.welfare.hasLegacyAdminSubject(linuxdoSubject)
        : Promise.resolve(false)
    ]);

    return byUserId || bySubject;
  }
}

const repository = new RiskRepository(pool);

export const distributionDetectionService = new DistributionDetectionService(
  repository,
  sessionStateService,
  sub2apiClient,
  new WelfareRepository(pool),
  console,
  usageAnalysisService
);

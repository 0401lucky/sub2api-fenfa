import { config } from '../config.js';
import { pool } from '../db.js';
import { UsageCacheRepository, type UsageCacheRecord } from '../repositories/usage-cache-repository.js';
import type { UsageSyncState } from '../types/domain.js';
import { extractLinuxDoSubjectFromEmail } from '../utils/oauth.js';

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

interface LoggerLike {
  warn(message: string, error?: unknown): void;
}

export interface EffectiveUsageEntry {
  usageId?: number;
  userId: number;
  email: string;
  username: string;
  linuxdoSubject: string | null;
  role: 'admin' | 'user';
  status: string;
  ipAddress: string;
  createdAt: string;
  createdAtMs: number;
}

export interface UsageExcludedBreakdown {
  invalidCreatedAt: number;
  missingUserId: number;
  missingIpAddress: number;
  outsideWindow: number;
}

export interface UsageAnalysisSnapshot {
  generatedAt: string;
  rawUsageCount24h: number;
  effectiveUsageCount24h: number;
  excludedCount24h: number;
  excludedBreakdown: UsageExcludedBreakdown;
  entries: EffectiveUsageEntry[];
  usageSyncState: UsageSyncState;
}

function normalizeIp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '' ? null : normalized;
}

function normalizeStatus(value: string): string {
  const normalized = value.trim();
  return normalized === '' ? 'active' : normalized;
}

function createEmptyBreakdown(): UsageExcludedBreakdown {
  return {
    invalidCreatedAt: 0,
    missingUserId: 0,
    missingIpAddress: 0,
    outsideWindow: 0
  };
}

export function buildUsageAnalysisSnapshot(
  rows: UsageCacheRecord[],
  usageSyncState: UsageSyncState,
  nowMs = Date.now()
): UsageAnalysisSnapshot {
  const cutoffMs = nowMs - WINDOW_24H_MS;
  const entries: EffectiveUsageEntry[] = [];
  const excludedBreakdown = createEmptyBreakdown();

  rows.forEach((row) => {
    const createdAtMs = row.createdAt ? Date.parse(row.createdAt) : Number.NaN;
    const normalizedIp = normalizeIp(row.ipAddress);
    const validUserId = Number.isInteger(row.sub2apiUserId) && (row.sub2apiUserId ?? 0) > 0;

    if (!row.createdAt || Number.isNaN(createdAtMs)) {
      excludedBreakdown.invalidCreatedAt += 1;
      return;
    }
    if (createdAtMs < cutoffMs || createdAtMs > nowMs) {
      excludedBreakdown.outsideWindow += 1;
      return;
    }
    if (!validUserId) {
      excludedBreakdown.missingUserId += 1;
      return;
    }
    if (!normalizedIp) {
      excludedBreakdown.missingIpAddress += 1;
      return;
    }

    const email =
      row.sub2apiEmail.trim() !== ''
        ? row.sub2apiEmail.trim()
        : `user-${row.sub2apiUserId}@unknown.invalid`;
    const username =
      row.sub2apiUsername.trim() !== ''
        ? row.sub2apiUsername.trim()
        : email;

    entries.push({
      usageId: row.usageId,
      userId: row.sub2apiUserId!,
      email,
      username,
      linuxdoSubject: extractLinuxDoSubjectFromEmail(email),
      role: row.sub2apiRole === 'admin' ? 'admin' : 'user',
      status: normalizeStatus(row.sub2apiStatus),
      ipAddress: normalizedIp,
      createdAt: row.createdAt,
      createdAtMs
    });
  });

  return {
    generatedAt: new Date(nowMs).toISOString(),
    rawUsageCount24h: rows.length,
    effectiveUsageCount24h: entries.length,
    excludedCount24h: rows.length - entries.length,
    excludedBreakdown,
    entries,
    usageSyncState
  };
}

export class UsageAnalysisService {
  private cache: { value: UsageAnalysisSnapshot; expiresAtMs: number } | null = null;
  private pending: Promise<UsageAnalysisSnapshot> | null = null;

  constructor(
    private readonly repository: UsageCacheRepository,
    private readonly logger: LoggerLike
  ) {}

  invalidate(): void {
    this.cache = null;
    this.pending = null;
  }

  async getSnapshot(forceRefresh = false): Promise<UsageAnalysisSnapshot> {
    const nowMs = Date.now();
    if (!forceRefresh && this.cache && this.cache.expiresAtMs > nowMs) {
      return this.cache.value;
    }

    if (!forceRefresh && this.pending) {
      return this.pending;
    }

    const task = this.loadSnapshot(nowMs).finally(() => {
      if (this.pending === task) {
        this.pending = null;
      }
    });
    this.pending = task;
    return task;
  }

  private async loadSnapshot(nowMs: number): Promise<UsageAnalysisSnapshot> {
    try {
      const cutoffIso = new Date(nowMs - WINDOW_24H_MS).toISOString();
      const [rows, usageSyncState] = await Promise.all([
        this.repository.listUsageSince(cutoffIso),
        this.repository.getSyncState()
      ]);
      const value = buildUsageAnalysisSnapshot(rows, usageSyncState, nowMs);
      this.cache = {
        value,
        expiresAtMs: nowMs + config.WELFARE_MONITOR_LIVE_CACHE_TTL_MS
      };
      return value;
    } catch (error) {
      this.logger.warn('[usage-analysis] 构建 usage 分析快照失败', error);
      throw error;
    }
  }
}

const repository = new UsageCacheRepository(pool);

export const usageAnalysisService = new UsageAnalysisService(repository, console);

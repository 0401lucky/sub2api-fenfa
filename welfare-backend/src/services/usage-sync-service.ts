import { config } from '../config.js';
import { pool } from '../db.js';
import { UsageCacheRepository, type SaveUsageCacheItem } from '../repositories/usage-cache-repository.js';
import { usageAnalysisService } from './usage-analysis-service.js';
import { sub2apiClient, type AdminUsageLogRecord, type Sub2apiClient } from './sub2api-client.js';

const USAGE_SYNC_LOCK_KEY = 2026040601n;
const USAGE_SYNC_PAGE_SIZE = 200;

interface LoggerLike {
  info(message: string): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function trimErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message.slice(0, 500);
  }

  return 'unknown error';
}

function toNullableIso(value: string): string | null {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function normalizeRole(value: string | undefined): 'admin' | 'user' {
  return value === 'admin' ? 'admin' : 'user';
}

function toSaveItem(log: AdminUsageLogRecord, syncedAt: string): SaveUsageCacheItem | null {
  if (!Number.isInteger(log.id) || log.id <= 0) {
    return null;
  }

  return {
    usageId: log.id,
    sub2apiUserId: Number.isInteger(log.userId) && log.userId > 0 ? log.userId : null,
    ipAddress: typeof log.ipAddress === 'string' ? log.ipAddress.trim() || null : null,
    createdAt: toNullableIso(log.createdAt),
    sub2apiEmail: log.user?.email?.trim() || '',
    sub2apiUsername: log.user?.username?.trim() || '',
    sub2apiRole: normalizeRole(log.user?.role),
    sub2apiStatus: log.user?.status?.trim() || 'active',
    rawPayload: {
      id: log.id,
      user_id: log.userId,
      ip_address: log.ipAddress,
      created_at: log.createdAt,
      user: log.user
    },
    syncedAt
  };
}

export class UsageSyncService {
  constructor(
    private readonly repository: UsageCacheRepository,
    private readonly sub2api: Pick<Sub2apiClient, 'listAdminUsageLogs'>,
    private readonly logger: LoggerLike
  ) {}

  startLoop(intervalMs = config.WELFARE_USAGE_SYNC_INTERVAL_MS): NodeJS.Timeout {
    const run = async () => {
      try {
        await this.syncRecentUsage();
      } catch (error) {
        this.logger.error('[usage-sync] 定时同步 usage 失败', error);
      }
    };

    void run();
    const timer = setInterval(() => {
      void run();
    }, intervalMs);
    timer.unref?.();
    return timer;
  }

  async syncRecentUsage(): Promise<{
    fetchedPageCount: number;
    upsertedCount: number;
    skipped: boolean;
  }> {
    const locked = await this.repository.tryAcquireSyncLock(USAGE_SYNC_LOCK_KEY);
    if (!locked) {
      this.logger.info('[usage-sync] 已有其他实例在同步 usage，跳过本轮');
      return {
        fetchedPageCount: 0,
        upsertedCount: 0,
        skipped: true
      };
    }

    const startedAt = new Date().toISOString();
    await this.repository.markSyncStarted(startedAt);

    try {
      const now = new Date();
      const startDate = toDateOnly(
        new Date(now.getTime() - config.WELFARE_USAGE_CACHE_RETENTION_MS)
      );
      const endDate = toDateOnly(now);
      let page = 1;
      let fetchedPageCount = 0;
      let upsertedCount = 0;

      while (true) {
        const result = await this.sub2api.listAdminUsageLogs({
          page,
          pageSize: USAGE_SYNC_PAGE_SIZE,
          startDate,
          endDate,
          timezone: 'UTC'
        });
        fetchedPageCount += 1;
        const syncedAt = new Date().toISOString();
        const items = result.items
          .map((item) => toSaveItem(item, syncedAt))
          .filter((item): item is SaveUsageCacheItem => item !== null);

        upsertedCount += await this.repository.upsertUsageItems(items);
        if (result.items.length < USAGE_SYNC_PAGE_SIZE) {
          break;
        }
        page += 1;
      }

      const cutoffIso = new Date(
        Date.now() - config.WELFARE_USAGE_CACHE_RETENTION_MS
      ).toISOString();
      await this.repository.deleteOlderThan(cutoffIso);
      await this.repository.markSyncFinished({
        status: 'success',
        finishedAt: new Date().toISOString(),
        error: '',
        fetchedPageCount,
        upsertedCount
      });
      usageAnalysisService.invalidate();

      return {
        fetchedPageCount,
        upsertedCount,
        skipped: false
      };
    } catch (error) {
      await this.repository.markSyncFinished({
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: trimErrorMessage(error),
        fetchedPageCount: 0,
        upsertedCount: 0
      });
      throw error;
    } finally {
      await this.repository.releaseSyncLock(USAGE_SYNC_LOCK_KEY);
    }
  }
}

const repository = new UsageCacheRepository(pool);

export const usageSyncService = new UsageSyncService(repository, sub2apiClient, console);

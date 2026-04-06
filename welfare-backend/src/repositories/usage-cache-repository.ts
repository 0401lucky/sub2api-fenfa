import type { Pool, PoolClient } from 'pg';
import type { UsageSyncState } from '../types/domain.js';

export interface SaveUsageCacheItem {
  usageId: number;
  sub2apiUserId: number | null;
  ipAddress: string | null;
  createdAt: string | null;
  sub2apiEmail: string;
  sub2apiUsername: string;
  sub2apiRole: 'admin' | 'user';
  sub2apiStatus: string;
  rawPayload: Record<string, unknown>;
  syncedAt: string;
}

export interface UsageCacheRecord extends SaveUsageCacheItem {}

function toNullableNumber(value: unknown): number | null {
  if (value == null) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function toJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === 'string') {
    try {
      return toJsonObject(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }

  return {};
}

export class UsageCacheRepository {
  constructor(private readonly db: Pool) {}

  async tryAcquireSyncLock(lockKey: bigint): Promise<boolean> {
    const result = await this.db.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS locked',
      [lockKey.toString()]
    );
    return Boolean(result.rows[0]?.locked);
  }

  async releaseSyncLock(lockKey: bigint): Promise<void> {
    await this.db.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey.toString()]);
  }

  async upsertUsageItems(items: SaveUsageCacheItem[], client?: PoolClient): Promise<number> {
    if (items.length === 0) {
      return 0;
    }

    const executor = client ?? this.db;
    let affected = 0;

    for (let index = 0; index < items.length; index += 200) {
      const chunk = items.slice(index, index + 200);
      const values: unknown[] = [];
      const tuples = chunk.map((item, rowIndex) => {
        const baseIndex = rowIndex * 10;
        values.push(
          item.usageId,
          item.sub2apiUserId,
          item.ipAddress,
          item.createdAt,
          item.sub2apiEmail,
          item.sub2apiUsername,
          item.sub2apiRole,
          item.sub2apiStatus,
          JSON.stringify(item.rawPayload),
          item.syncedAt
        );
        return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9}::jsonb, $${baseIndex + 10})`;
      });

      const result = await executor.query(
        `INSERT INTO welfare_usage_cache (
           usage_id,
           sub2api_user_id,
           ip_address,
           created_at,
           sub2api_email,
           sub2api_username,
           sub2api_role,
           sub2api_status,
           raw_payload,
           synced_at
         )
         VALUES ${tuples.join(', ')}
         ON CONFLICT (usage_id) DO UPDATE
         SET sub2api_user_id = EXCLUDED.sub2api_user_id,
             ip_address = EXCLUDED.ip_address,
             created_at = EXCLUDED.created_at,
             sub2api_email = EXCLUDED.sub2api_email,
             sub2api_username = EXCLUDED.sub2api_username,
             sub2api_role = EXCLUDED.sub2api_role,
             sub2api_status = EXCLUDED.sub2api_status,
             raw_payload = EXCLUDED.raw_payload,
             synced_at = EXCLUDED.synced_at`,
        values
      );
      affected += result.rowCount ?? 0;
    }

    return affected;
  }

  async deleteOlderThan(cutoffIso: string): Promise<number> {
    const result = await this.db.query(
      `DELETE FROM welfare_usage_cache
       WHERE COALESCE(created_at, synced_at) < $1::timestamptz`,
      [cutoffIso]
    );

    return result.rowCount ?? 0;
  }

  async listUsageSince(cutoffIso: string): Promise<UsageCacheRecord[]> {
    const result = await this.db.query(
      `SELECT *
       FROM welfare_usage_cache
       WHERE COALESCE(created_at, synced_at) >= $1::timestamptz
       ORDER BY COALESCE(created_at, synced_at) DESC, usage_id DESC`,
      [cutoffIso]
    );

    return result.rows.map((row) => this.mapUsageRecord(row));
  }

  async getSyncState(): Promise<UsageSyncState> {
    const result = await this.db.query(
      `SELECT *
       FROM welfare_usage_sync_state
       WHERE id = 1
       LIMIT 1`
    );

    if ((result.rowCount ?? 0) === 0) {
      await this.db.query(
        `INSERT INTO welfare_usage_sync_state (id, last_status)
         VALUES (1, 'idle')
         ON CONFLICT (id) DO NOTHING`
      );
      return this.getSyncState();
    }

    return this.mapSyncState(result.rows[0]);
  }

  async markSyncStarted(startedAt: string): Promise<void> {
    await this.db.query(
      `UPDATE welfare_usage_sync_state
       SET last_started_at = $1,
           last_status = 'running',
           last_error = '',
           fetched_page_count = 0,
           upserted_count = 0,
           updated_at = NOW()
       WHERE id = 1`,
      [startedAt]
    );
  }

  async markSyncFinished(input: {
    status: 'success' | 'failed';
    finishedAt: string;
    error: string;
    fetchedPageCount: number;
    upsertedCount: number;
  }): Promise<void> {
    await this.db.query(
      `UPDATE welfare_usage_sync_state
       SET last_finished_at = $1,
           last_status = $2,
           last_error = $3,
           fetched_page_count = $4,
           upserted_count = $5,
           updated_at = NOW()
       WHERE id = 1`,
      [
        input.finishedAt,
        input.status,
        input.error,
        input.fetchedPageCount,
        input.upsertedCount
      ]
    );
  }

  private mapUsageRecord(row: Record<string, unknown>): UsageCacheRecord {
    const role = row.sub2api_role === 'admin' ? 'admin' : 'user';
    return {
      usageId: Number(row.usage_id),
      sub2apiUserId: toNullableNumber(row.sub2api_user_id),
      ipAddress: toNullableString(row.ip_address),
      createdAt: toNullableString(row.created_at),
      sub2apiEmail: String(row.sub2api_email ?? ''),
      sub2apiUsername: String(row.sub2api_username ?? ''),
      sub2apiRole: role,
      sub2apiStatus: String(row.sub2api_status ?? ''),
      rawPayload: toJsonObject(row.raw_payload),
      syncedAt: String(row.synced_at ?? row.created_at ?? '')
    };
  }

  private mapSyncState(row: Record<string, unknown>): UsageSyncState {
    return {
      lastStartedAt: toNullableString(row.last_started_at),
      lastFinishedAt: toNullableString(row.last_finished_at),
      lastStatus:
        row.last_status === 'running' ||
        row.last_status === 'success' ||
        row.last_status === 'failed'
          ? row.last_status
          : 'idle',
      lastError: String(row.last_error ?? ''),
      fetchedPageCount: Number(row.fetched_page_count ?? 0),
      upsertedCount: Number(row.upserted_count ?? 0),
      updatedAt: String(row.updated_at ?? row.created_at ?? '')
    };
  }
}

import type { Pool, PoolClient } from 'pg';
import type {
  RiskEvent,
  RiskEventStatus,
  RiskScanState,
  RiskSyncStatus
} from '../types/domain.js';

export interface SaveRiskEventInput {
  sub2apiUserId: number;
  sub2apiEmail: string;
  sub2apiUsername: string;
  linuxdoSubject: string | null;
  sub2apiRole: 'admin' | 'user';
  sub2apiStatus: string;
  status: Extract<RiskEventStatus, 'active' | 'pending_release'>;
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
  lastScannedAt: string;
}

interface UpdateRiskMainSiteSyncInput {
  sub2apiStatus: string;
  mainSiteSyncStatus: RiskSyncStatus;
  mainSiteSyncError: string;
}

export interface ReleaseRiskEventInput {
  sub2apiStatus: string;
  mainSiteSyncStatus?: RiskSyncStatus;
  mainSiteSyncError?: string;
  releasedBySub2apiUserId: number;
  releasedByEmail: string;
  releasedByUsername: string;
  releaseReason: string;
  releasedAt: string;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return toStringArray(parsed);
    } catch {
      return [];
    }
  }

  return [];
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export class RiskRepository {
  constructor(private readonly db: Pool) {}

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async refreshExpiredActiveEvents(sub2apiUserId?: number): Promise<number> {
    return this.syncExpiredEvents(new Date().toISOString(), undefined, sub2apiUserId);
  }

  async syncExpiredEvents(
    syncAt: string,
    client?: PoolClient,
    sub2apiUserId?: number
  ): Promise<number> {
    const executor = client ?? this.db;
    const values: unknown[] = [syncAt];
    const filters = ['status = \'active\'', `minimum_lock_until <= $1::timestamptz`];
    if (sub2apiUserId) {
      values.push(sub2apiUserId);
      filters.push(`sub2api_user_id = $${values.length}`);
    }

    const result = await executor.query(
      `UPDATE welfare_risk_events
       SET status = 'pending_release',
           updated_at = NOW()
       WHERE ${filters.join(' AND ')}`,
      values
    );

    return result.rowCount ?? 0;
  }

  async markExpiredEventsPendingRelease(sub2apiUserId?: number): Promise<number> {
    return this.refreshExpiredActiveEvents(sub2apiUserId);
  }

  async getOpenRiskEventByUserId(sub2apiUserId: number): Promise<RiskEvent | null> {
    return this.getBlockingEventByUserId(sub2apiUserId);
  }

  async getBlockingEventByUserId(
    sub2apiUserId: number,
    options?: {
      client?: PoolClient;
      forUpdate?: boolean;
    }
  ): Promise<RiskEvent | null> {
    const executor = options?.client ?? this.db;
    const result = await executor.query(
      `SELECT *
       FROM welfare_risk_events
       WHERE sub2api_user_id = $1
         AND status IN ('active', 'pending_release')
       LIMIT 1
       ${options?.forUpdate ? 'FOR UPDATE' : ''}`,
      [sub2apiUserId]
    );

    return result.rowCount ? this.mapRiskEvent(result.rows[0]) : null;
  }

  async findOpenRiskEventByUserId(sub2apiUserId: number): Promise<RiskEvent | null> {
    return this.getOpenRiskEventByUserId(sub2apiUserId);
  }

  async getRiskEventById(id: number): Promise<RiskEvent | null> {
    const result = await this.db.query(
      `SELECT *
       FROM welfare_risk_events
       WHERE id = $1
       LIMIT 1`,
      [id]
    );

    return result.rowCount ? this.mapRiskEvent(result.rows[0]) : null;
  }

  async upsertOpenRiskEvent(
    input: SaveRiskEventInput,
    client: PoolClient
  ): Promise<{ event: RiskEvent; created: boolean }> {
    const existingResult = await client.query(
      `SELECT *
       FROM welfare_risk_events
       WHERE sub2api_user_id = $1
         AND status IN ('active', 'pending_release')
       FOR UPDATE`,
      [input.sub2apiUserId]
    );

    if ((existingResult.rowCount ?? 0) > 0) {
      const existing = existingResult.rows[0] as Record<string, unknown>;
      const result = await client.query(
        `UPDATE welfare_risk_events
         SET sub2api_email = $2,
             sub2api_username = $3,
             linuxdo_subject = $4,
             sub2api_role = $5,
             sub2api_status = $6,
             status = $7,
             window_started_at = $8,
             window_ended_at = $9,
             distinct_ip_count = $10,
             ip_samples = $11::jsonb,
             last_hit_at = $12,
             minimum_lock_until = $13,
             main_site_sync_status = $14,
             main_site_sync_error = $15,
             last_scan_status = $16,
             last_scan_error = $17,
             last_scan_source = $18,
             last_scanned_at = $19,
             released_by_sub2api_user_id = NULL,
             released_by_email = '',
             released_by_username = '',
             release_reason = '',
             released_at = NULL,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          Number(existing.id),
          input.sub2apiEmail,
          input.sub2apiUsername,
          input.linuxdoSubject,
          input.sub2apiRole,
          input.sub2apiStatus,
          input.status,
          input.windowStartedAt,
          input.windowEndedAt,
          input.distinctIpCount,
          JSON.stringify(input.ipSamples),
          input.lastHitAt,
          input.minimumLockUntil,
          input.mainSiteSyncStatus,
          input.mainSiteSyncError,
          input.lastScanStatus,
          input.lastScanError,
          input.lastScanSource,
          input.lastScannedAt
        ]
      );

      return {
        event: this.mapRiskEvent(result.rows[0]),
        created: false
      };
    }

    const result = await client.query(
      `INSERT INTO welfare_risk_events (
         sub2api_user_id,
         sub2api_email,
         sub2api_username,
         linuxdo_subject,
         sub2api_role,
         sub2api_status,
         status,
         window_started_at,
         window_ended_at,
         distinct_ip_count,
         ip_samples,
         first_hit_at,
         last_hit_at,
         minimum_lock_until,
         main_site_sync_status,
         main_site_sync_error,
         last_scan_status,
         last_scan_error,
         last_scan_source,
         last_scanned_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14,
         $15, $16, $17, $18, $19, $20
       )
       RETURNING *`,
      [
        input.sub2apiUserId,
        input.sub2apiEmail,
        input.sub2apiUsername,
        input.linuxdoSubject,
        input.sub2apiRole,
        input.sub2apiStatus,
        input.status,
        input.windowStartedAt,
        input.windowEndedAt,
        input.distinctIpCount,
        JSON.stringify(input.ipSamples),
        input.firstHitAt,
        input.lastHitAt,
        input.minimumLockUntil,
        input.mainSiteSyncStatus,
        input.mainSiteSyncError,
        input.lastScanStatus,
        input.lastScanError,
        input.lastScanSource,
        input.lastScannedAt
      ]
    );

    return {
      event: this.mapRiskEvent(result.rows[0]),
      created: true
    };
  }

  async createRiskEvent(input: SaveRiskEventInput): Promise<RiskEvent> {
    return this.withTransaction(async (client) => {
      const result = await this.upsertOpenRiskEvent(input, client);
      return result.event;
    });
  }

  async createBlockingEvent(
    input: SaveRiskEventInput,
    client: PoolClient
  ): Promise<RiskEvent> {
    const result = await client.query(
      `INSERT INTO welfare_risk_events (
         sub2api_user_id,
         sub2api_email,
         sub2api_username,
         linuxdo_subject,
         sub2api_role,
         sub2api_status,
         status,
         window_started_at,
         window_ended_at,
         distinct_ip_count,
         ip_samples,
         first_hit_at,
         last_hit_at,
         minimum_lock_until,
         main_site_sync_status,
         main_site_sync_error,
         last_scan_status,
         last_scan_error,
         last_scan_source,
         last_scanned_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14,
         $15, $16, $17, $18, $19, $20
       )
       RETURNING *`,
      [
        input.sub2apiUserId,
        input.sub2apiEmail,
        input.sub2apiUsername,
        input.linuxdoSubject,
        input.sub2apiRole,
        input.sub2apiStatus,
        input.status,
        input.windowStartedAt,
        input.windowEndedAt,
        input.distinctIpCount,
        JSON.stringify(input.ipSamples),
        input.firstHitAt,
        input.lastHitAt,
        input.minimumLockUntil,
        input.mainSiteSyncStatus,
        input.mainSiteSyncError,
        input.lastScanStatus,
        input.lastScanError,
        input.lastScanSource,
        input.lastScannedAt
      ]
    );

    return this.mapRiskEvent(result.rows[0]);
  }

  async refreshOpenRiskEvent(
    eventId: number,
    input: SaveRiskEventInput
  ): Promise<RiskEvent | null> {
    const result = await this.db.query(
      `UPDATE welfare_risk_events
       SET sub2api_email = $2,
           sub2api_username = $3,
           linuxdo_subject = $4,
           sub2api_role = $5,
           sub2api_status = $6,
           status = $7,
           window_started_at = $8,
           window_ended_at = $9,
           distinct_ip_count = $10,
           ip_samples = $11::jsonb,
           first_hit_at = $12,
           last_hit_at = $13,
           minimum_lock_until = $14,
           main_site_sync_status = $15,
           main_site_sync_error = $16,
           last_scan_status = $17,
           last_scan_error = $18,
           last_scan_source = $19,
           last_scanned_at = $20,
           released_by_sub2api_user_id = NULL,
           released_by_email = '',
           released_by_username = '',
           release_reason = '',
           released_at = NULL,
           updated_at = NOW()
       WHERE id = $1
         AND status IN ('active', 'pending_release')
       RETURNING *`,
      [
        eventId,
        input.sub2apiEmail,
        input.sub2apiUsername,
        input.linuxdoSubject,
        input.sub2apiRole,
        input.sub2apiStatus,
        input.status,
        input.windowStartedAt,
        input.windowEndedAt,
        input.distinctIpCount,
        JSON.stringify(input.ipSamples),
        input.firstHitAt,
        input.lastHitAt,
        input.minimumLockUntil,
        input.mainSiteSyncStatus,
        input.mainSiteSyncError,
        input.lastScanStatus,
        input.lastScanError,
        input.lastScanSource,
        input.lastScannedAt
      ]
    );

    return result.rowCount ? this.mapRiskEvent(result.rows[0]) : null;
  }

  async updateBlockingEventFromHit(
    eventId: number,
    input: SaveRiskEventInput,
    client: PoolClient
  ): Promise<RiskEvent> {
    const result = await client.query(
      `UPDATE welfare_risk_events
       SET sub2api_email = $2,
           sub2api_username = $3,
           linuxdo_subject = $4,
           sub2api_role = $5,
           sub2api_status = $6,
           status = $7,
           window_started_at = $8,
           window_ended_at = $9,
           distinct_ip_count = $10,
           ip_samples = $11::jsonb,
           first_hit_at = $12,
           last_hit_at = $13,
           minimum_lock_until = $14,
           main_site_sync_status = $15,
           main_site_sync_error = $16,
           last_scan_status = $17,
           last_scan_error = $18,
           last_scan_source = $19,
           last_scanned_at = $20,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        eventId,
        input.sub2apiEmail,
        input.sub2apiUsername,
        input.linuxdoSubject,
        input.sub2apiRole,
        input.sub2apiStatus,
        input.status,
        input.windowStartedAt,
        input.windowEndedAt,
        input.distinctIpCount,
        JSON.stringify(input.ipSamples),
        input.firstHitAt,
        input.lastHitAt,
        input.minimumLockUntil,
        input.mainSiteSyncStatus,
        input.mainSiteSyncError,
        input.lastScanStatus,
        input.lastScanError,
        input.lastScanSource,
        input.lastScannedAt
      ]
    );

    return this.mapRiskEvent(result.rows[0]);
  }

  async updateRiskEventMainSiteSync(
    eventId: number,
    input: UpdateRiskMainSiteSyncInput
  ): Promise<RiskEvent> {
    const result = await this.db.query(
      `UPDATE welfare_risk_events
       SET sub2api_status = $2,
           main_site_sync_status = $3,
           main_site_sync_error = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [eventId, input.sub2apiStatus, input.mainSiteSyncStatus, input.mainSiteSyncError]
    );

    return this.mapRiskEvent(result.rows[0]);
  }

  async markRiskEventMainSiteSync(
    eventId: number,
    input: UpdateRiskMainSiteSyncInput
  ): Promise<RiskEvent> {
    return this.updateRiskEventMainSiteSync(eventId, input);
  }

  async updateRiskEventSync(
    eventId: number,
    input: UpdateRiskMainSiteSyncInput
  ): Promise<RiskEvent> {
    return this.updateRiskEventMainSiteSync(eventId, input);
  }

  async releaseRiskEvent(eventId: number, input: ReleaseRiskEventInput): Promise<RiskEvent> {
    const result = await this.db.query(
      `UPDATE welfare_risk_events
       SET sub2api_status = $2,
           status = 'released',
           main_site_sync_status = $3,
           main_site_sync_error = $4,
           last_scan_status = 'success',
           last_scan_error = '',
           released_by_sub2api_user_id = $5,
           released_by_email = $6,
           released_by_username = $7,
           release_reason = $8,
           released_at = $9,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        eventId,
        input.sub2apiStatus,
        input.mainSiteSyncStatus ?? 'success',
        input.mainSiteSyncError ?? '',
        input.releasedBySub2apiUserId,
        input.releasedByEmail,
        input.releasedByUsername,
        input.releaseReason,
        input.releasedAt
      ]
    );

    return this.mapRiskEvent(result.rows[0]);
  }

  async listRiskEvents(params: {
    page: number;
    pageSize: number;
    status?: RiskEventStatus;
    search?: string;
  }): Promise<{ items: RiskEvent[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.status) {
      values.push(params.status);
      conditions.push(`status = $${values.length}`);
    }

    if (params.search?.trim()) {
      values.push(`%${params.search.trim()}%`);
      conditions.push(
        `(sub2api_email ILIKE $${values.length}
          OR sub2api_username ILIKE $${values.length}
          OR COALESCE(linuxdo_subject, '') ILIKE $${values.length}
          OR sub2api_user_id::text ILIKE $${values.length})`
      );
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (params.page - 1) * params.pageSize;
    const totalResult = await this.db.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM welfare_risk_events
       ${whereClause}`,
      values
    );

    values.push(params.pageSize);
    values.push(offset);
    const listResult = await this.db.query(
      `SELECT *
       FROM welfare_risk_events
       ${whereClause}
       ORDER BY
         CASE status
           WHEN 'active' THEN 0
           WHEN 'pending_release' THEN 1
           ELSE 2
         END ASC,
         updated_at DESC,
         id DESC
       LIMIT $${values.length - 1}
       OFFSET $${values.length}`,
      values
    );

    return {
      items: listResult.rows.map((row) => this.mapRiskEvent(row)),
      total: Number(totalResult.rows[0]?.total ?? 0)
    };
  }

  async listRiskEventsForStatuses(
    statuses: RiskEventStatus[],
    limit = 500
  ): Promise<RiskEvent[]> {
    if (statuses.length === 0) {
      return [];
    }

    const result = await this.db.query(
      `SELECT *
       FROM welfare_risk_events
       WHERE status = ANY($1::text[])
       ORDER BY updated_at DESC, id DESC
       LIMIT $2`,
      [statuses, limit]
    );

    return result.rows.map((row) => this.mapRiskEvent(row));
  }

  async getRiskOverview(): Promise<{
    activeEventCount: number;
    pendingReleaseCount: number;
    openEventCount: number;
  }> {
    const [activeResult, pendingResult, openResult] = await Promise.all([
      this.db.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM welfare_risk_events
         WHERE status = 'active'`
      ),
      this.db.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM welfare_risk_events
         WHERE status = 'pending_release'`
      ),
      this.db.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM welfare_risk_events
         WHERE status IN ('active', 'pending_release')`
      )
    ]);

    return {
      activeEventCount: Number(activeResult.rows[0]?.total ?? 0),
      pendingReleaseCount: Number(pendingResult.rows[0]?.total ?? 0),
      openEventCount: Number(openResult.rows[0]?.total ?? 0)
    };
  }

  async getRiskScanState(): Promise<RiskScanState> {
    const result = await this.db.query(
      `SELECT *
       FROM welfare_risk_scan_state
       WHERE id = 1
       LIMIT 1`
    );

    if ((result.rowCount ?? 0) === 0) {
      await this.db.query(
        `INSERT INTO welfare_risk_scan_state (id, last_status)
         VALUES (1, 'idle')
         ON CONFLICT (id) DO NOTHING`
      );
      return this.getRiskScanState();
    }

    const row = result.rows[0] as Record<string, unknown>;
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
      lastTriggerSource: String(row.last_trigger_source ?? ''),
      scannedUserCount: Number(row.scanned_user_count ?? 0),
      hitUserCount: Number(row.hit_user_count ?? 0),
      updatedAt: String(row.updated_at ?? row.created_at ?? '')
    };
  }

  async markRiskScanRunning(startedAt: string, triggerSource: string): Promise<void> {
    await this.db.query(
      `UPDATE welfare_risk_scan_state
       SET last_started_at = $1,
           last_finished_at = NULL,
           last_status = 'running',
           last_error = '',
           last_trigger_source = $2,
           scanned_user_count = 0,
           hit_user_count = 0,
           updated_at = NOW()
       WHERE id = 1`,
      [startedAt, triggerSource]
    );
  }

  async finishRiskScan(input: {
    finishedAt: string;
    status: Extract<RiskScanState['lastStatus'], 'success' | 'failed'>;
    error: string;
    triggerSource: string;
    scannedUserCount: number;
    hitUserCount: number;
  }): Promise<void> {
    await this.db.query(
      `UPDATE welfare_risk_scan_state
       SET last_finished_at = $1,
           last_status = $2,
           last_error = $3,
           last_trigger_source = $4,
           scanned_user_count = $5,
           hit_user_count = $6,
           updated_at = NOW()
       WHERE id = 1`,
      [
        input.finishedAt,
        input.status,
        input.error,
        input.triggerSource,
        input.scannedUserCount,
        input.hitUserCount
      ]
    );
  }

  async updateRiskScanState(input: {
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    lastStatus: RiskScanState['lastStatus'];
    lastError: string;
    lastTriggerSource: string;
    scannedUserCount?: number;
    hitUserCount?: number;
  }): Promise<RiskScanState> {
    const result = await this.db.query(
      `INSERT INTO welfare_risk_scan_state (
         id,
         last_started_at,
         last_finished_at,
         last_status,
         last_error,
         last_trigger_source,
         scanned_user_count,
         hit_user_count
       )
       VALUES (1, $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id)
       DO UPDATE SET
         last_started_at = EXCLUDED.last_started_at,
         last_finished_at = EXCLUDED.last_finished_at,
         last_status = EXCLUDED.last_status,
         last_error = EXCLUDED.last_error,
         last_trigger_source = EXCLUDED.last_trigger_source,
         scanned_user_count = EXCLUDED.scanned_user_count,
         hit_user_count = EXCLUDED.hit_user_count,
         updated_at = NOW()
       RETURNING *`,
      [
        input.lastStartedAt,
        input.lastFinishedAt,
        input.lastStatus,
        input.lastError,
        input.lastTriggerSource,
        input.scannedUserCount ?? 0,
        input.hitUserCount ?? 0
      ]
    );

    return this.mapRiskScanState(result.rows[0]);
  }

  async markRiskScanStarted(source: string, startedAt: string): Promise<void> {
    await this.markRiskScanRunning(startedAt, source);
  }

  async markRiskScanFinished(input: {
    status: Extract<RiskScanState['lastStatus'], 'success' | 'failed'>;
    source: string;
    finishedAt: string;
    error: string;
    scannedUserCount: number;
    hitUserCount: number;
  }): Promise<void> {
    await this.finishRiskScan({
      finishedAt: input.finishedAt,
      status: input.status,
      error: input.error,
      triggerSource: input.source,
      scannedUserCount: input.scannedUserCount,
      hitUserCount: input.hitUserCount
    });
  }

  async getRiskEventCounts(): Promise<{
    active: number;
    pending_release: number;
    released: number;
  }> {
    const result = await this.db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active')::int AS active,
         COUNT(*) FILTER (WHERE status = 'pending_release')::int AS pending_release,
         COUNT(*) FILTER (WHERE status = 'released')::int AS released
       FROM welfare_risk_events`
    );

    const row = result.rows[0] as Record<string, unknown>;
    return {
      active: Number(row.active ?? 0),
      pending_release: Number(row.pending_release ?? 0),
      released: Number(row.released ?? 0)
    };
  }

  private mapRiskEvent(row: Record<string, unknown>): RiskEvent {
    return {
      id: Number(row.id),
      sub2apiUserId: Number(row.sub2api_user_id),
      sub2apiEmail: String(row.sub2api_email ?? ''),
      sub2apiUsername: String(row.sub2api_username ?? ''),
      linuxdoSubject: toNullableString(row.linuxdo_subject),
      sub2apiRole: row.sub2api_role === 'admin' ? 'admin' : 'user',
      sub2apiStatus: String(row.sub2api_status ?? ''),
      eventType: 'distribution_ip',
      status:
        row.status === 'pending_release' || row.status === 'released'
          ? row.status
          : 'active',
      windowStartedAt: String(row.window_started_at),
      windowEndedAt: String(row.window_ended_at),
      distinctIpCount: Number(row.distinct_ip_count ?? 0),
      ipSamples: toStringArray(row.ip_samples),
      firstHitAt: String(row.first_hit_at),
      lastHitAt: String(row.last_hit_at),
      minimumLockUntil: String(row.minimum_lock_until),
      mainSiteSyncStatus:
        row.main_site_sync_status === 'success' || row.main_site_sync_status === 'failed'
          ? row.main_site_sync_status
          : 'pending',
      mainSiteSyncError: String(row.main_site_sync_error ?? ''),
      lastScanStatus: row.last_scan_status === 'failed' ? 'failed' : 'success',
      lastScanError: String(row.last_scan_error ?? ''),
      lastScanSource: String(row.last_scan_source ?? ''),
      lastScannedAt: toNullableString(row.last_scanned_at),
      releasedBySub2apiUserId:
        row.released_by_sub2api_user_id == null
          ? null
          : Number(row.released_by_sub2api_user_id),
      releasedByEmail: String(row.released_by_email ?? ''),
      releasedByUsername: String(row.released_by_username ?? ''),
      releaseReason: String(row.release_reason ?? ''),
      releasedAt: toNullableString(row.released_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at ?? row.created_at)
    };
  }

  private mapRiskScanState(row: Record<string, unknown>): RiskScanState {
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
      lastTriggerSource: String(row.last_trigger_source ?? ''),
      scannedUserCount: Number(row.scanned_user_count ?? 0),
      hitUserCount: Number(row.hit_user_count ?? 0),
      updatedAt: String(row.updated_at ?? row.created_at ?? '')
    };
  }
}

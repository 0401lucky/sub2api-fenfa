import type { Pool } from 'pg';
import type {
  MonitoringAction,
  MonitoringActionResultStatus,
  MonitoringActionTargetType,
  MonitoringActionType,
  MonitoringSnapshot
} from '../types/domain.js';

export interface SaveMonitoringSnapshotInput {
  snapshotAt: string;
  rawRequestCount24h: number;
  requestCount24h: number;
  activeUserCount24h: number;
  uniqueIpCount24h: number;
  observeUserCount1h: number;
  blockedUserCount: number;
  pendingReleaseCount: number;
  sharedIpCount1h: number;
  sharedIpCount24h: number;
}

export interface SaveMonitoringActionInput {
  actionType: MonitoringActionType;
  targetType: MonitoringActionTargetType;
  targetId: number | null;
  targetLabel: string;
  operatorSub2apiUserId: number;
  operatorEmail: string;
  operatorUsername: string;
  reason: string;
  resultStatus: MonitoringActionResultStatus;
  detail: string;
  metadata?: Record<string, unknown>;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

export class MonitoringRepository {
  constructor(private readonly db: Pool) {}

  async saveSnapshot(input: SaveMonitoringSnapshotInput): Promise<MonitoringSnapshot> {
    const result = await this.db.query(
      `INSERT INTO welfare_monitoring_snapshots (
         snapshot_at,
         raw_request_count_24h,
         request_count_24h,
         active_user_count_24h,
         unique_ip_count_24h,
         observe_user_count_1h,
         blocked_user_count,
         pending_release_count,
         shared_ip_count_1h,
         shared_ip_count_24h
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        input.snapshotAt,
        input.rawRequestCount24h,
        input.requestCount24h,
        input.activeUserCount24h,
        input.uniqueIpCount24h,
        input.observeUserCount1h,
        input.blockedUserCount,
        input.pendingReleaseCount,
        input.sharedIpCount1h,
        input.sharedIpCount24h
      ]
    );

    return this.mapSnapshot(result.rows[0]);
  }

  async purgeSnapshotsOlderThan(retentionDays: number): Promise<number> {
    const result = await this.db.query(
      `DELETE FROM welfare_monitoring_snapshots
       WHERE snapshot_at < NOW() - ($1::text || ' days')::interval`,
      [retentionDays]
    );

    return result.rowCount ?? 0;
  }

  async listSnapshots(limit = 48): Promise<MonitoringSnapshot[]> {
    const result = await this.db.query(
      `SELECT *
       FROM welfare_monitoring_snapshots
       ORDER BY snapshot_at DESC, id DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row) => this.mapSnapshot(row)).reverse();
  }

  async createAction(input: SaveMonitoringActionInput): Promise<MonitoringAction> {
    const result = await this.db.query(
      `INSERT INTO welfare_monitoring_actions (
         action_type,
         target_type,
         target_id,
         target_label,
         operator_sub2api_user_id,
         operator_email,
         operator_username,
         reason,
         result_status,
         detail,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       RETURNING *`,
      [
        input.actionType,
        input.targetType,
        input.targetId,
        input.targetLabel,
        input.operatorSub2apiUserId,
        input.operatorEmail,
        input.operatorUsername,
        input.reason,
        input.resultStatus,
        input.detail,
        JSON.stringify(input.metadata ?? {})
      ]
    );

    return this.mapAction(result.rows[0]);
  }

  async listActions(params: {
    page: number;
    pageSize: number;
    actionType?: MonitoringActionType;
  }): Promise<{ items: MonitoringAction[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.actionType) {
      values.push(params.actionType);
      conditions.push(`action_type = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const totalResult = await this.db.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM welfare_monitoring_actions
       ${whereClause}`,
      values
    );

    values.push(params.pageSize);
    values.push((params.page - 1) * params.pageSize);
    const result = await this.db.query(
      `SELECT *
       FROM welfare_monitoring_actions
       ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length - 1}
       OFFSET $${values.length}`,
      values
    );

    return {
      items: result.rows.map((row) => this.mapAction(row)),
      total: Number(totalResult.rows[0]?.total ?? 0)
    };
  }

  private mapSnapshot(row: Record<string, unknown>): MonitoringSnapshot {
    return {
      id: Number(row.id),
      snapshotAt: String(row.snapshot_at),
      rawRequestCount24h: Number(row.raw_request_count_24h ?? 0),
      requestCount24h: Number(row.request_count_24h ?? 0),
      activeUserCount24h: Number(row.active_user_count_24h ?? 0),
      uniqueIpCount24h: Number(row.unique_ip_count_24h ?? 0),
      observeUserCount1h: Number(row.observe_user_count_1h ?? 0),
      blockedUserCount: Number(row.blocked_user_count ?? 0),
      pendingReleaseCount: Number(row.pending_release_count ?? 0),
      sharedIpCount1h: Number(row.shared_ip_count_1h ?? 0),
      sharedIpCount24h: Number(row.shared_ip_count_24h ?? 0),
      createdAt: String(row.created_at ?? row.snapshot_at)
    };
  }

  private mapAction(row: Record<string, unknown>): MonitoringAction {
    const actionType =
      row.action_type === 'disable_user' ||
      row.action_type === 'enable_user' ||
      row.action_type === 'release_risk_event' ||
      row.action_type === 'cloudflare_challenge_ip' ||
      row.action_type === 'cloudflare_block_ip' ||
      row.action_type === 'cloudflare_unblock_ip'
        ? row.action_type
        : 'run_risk_scan';
    const targetType =
      row.target_type === 'user' ||
      row.target_type === 'risk_event' ||
      row.target_type === 'ip'
        ? row.target_type
        : 'scan';
    const resultStatus =
      row.result_status === 'failed' || row.result_status === 'blocked'
        ? row.result_status
        : 'success';

    return {
      id: Number(row.id),
      actionType,
      targetType,
      targetId: toNullableNumber(row.target_id),
      targetLabel: String(row.target_label ?? ''),
      operatorSub2apiUserId: Number(row.operator_sub2api_user_id ?? 0),
      operatorEmail: String(row.operator_email ?? ''),
      operatorUsername: String(row.operator_username ?? ''),
      reason: String(row.reason ?? ''),
      resultStatus,
      detail: String(row.detail ?? ''),
      metadata: toJsonObject(row.metadata),
      createdAt: String(row.created_at ?? '')
    };
  }
}

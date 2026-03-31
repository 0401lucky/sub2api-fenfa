import type { Pool, PoolClient } from 'pg';
import type {
  BlindboxItem,
  CheckinMode,
  CheckinRecord,
  ResetRecord,
  WelfareSettings
} from '../types/domain.js';
import { config } from '../config.js';

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  throw new Error(`无法转换数值: ${String(value)}`);
}

export interface CreateCheckinInput {
  sub2apiUserId: number;
  sub2apiEmail: string;
  sub2apiUsername: string;
  linuxdoSubject: string | null;
  checkinDate: string;
  checkinMode: CheckinMode;
  blindboxItemId?: number | null;
  blindboxTitle?: string;
  rewardBalance: number;
  idempotencyKey: string;
}

export interface AdminWhitelistItem {
  id: number;
  sub2apiUserId: number | null;
  email: string;
  username: string;
  linuxdoSubject: string | null;
  notes: string;
  createdAt: string;
}

export interface CreateAdminWhitelistInput {
  sub2apiUserId: number;
  email: string;
  username: string;
  linuxdoSubject: string | null;
  notes: string;
}

export interface CreateBlindboxItemInput {
  title: string;
  rewardBalance: number;
  weight: number;
  enabled: boolean;
  notes: string;
  sortOrder: number;
}

export interface UpdateBlindboxItemInput {
  title?: string;
  rewardBalance?: number;
  weight?: number;
  enabled?: boolean;
  notes?: string;
  sortOrder?: number;
}

export interface CreateResetRecordInput {
  sub2apiUserId: number;
  sub2apiEmail: string;
  sub2apiUsername: string;
  linuxdoSubject: string | null;
  beforeBalance: number;
  thresholdBalance: number;
  targetBalance: number;
  grantedBalance: number;
  cooldownDays: number;
  idempotencyKey: string;
}

export interface UserActivitySummary {
  sub2apiUserId: number;
  checkinCount: number;
  redeemCount: number;
  resetCount: number;
}

export interface CreateUserCleanupLogInput {
  operatorSub2apiUserId: number;
  operatorEmail: string;
  operatorUsername: string;
  targetSub2apiUserId: number;
  targetEmail: string;
  targetUsername: string;
  targetBalance: number | null;
  resultStatus: 'success' | 'failed';
  detail: string;
}

export class WelfareRepository {
  constructor(private readonly db: Pool) {}

  async getSettings(client?: PoolClient): Promise<WelfareSettings> {
    const executor = client ?? this.db;
    const result = await executor.query(
      `SELECT checkin_enabled,
              blindbox_enabled,
              daily_reward_balance,
              daily_reward_min_balance,
              daily_reward_max_balance,
              timezone,
              reset_enabled,
              reset_threshold_balance,
              reset_target_balance,
              reset_cooldown_days,
              reset_notice
       FROM welfare_settings
       WHERE id = 1`
    );
    if (result.rowCount === 0) {
      await executor.query(
        `INSERT INTO welfare_settings (
           id,
           checkin_enabled,
           blindbox_enabled,
           daily_reward_balance,
           daily_reward_min_balance,
           daily_reward_max_balance,
           timezone,
           reset_enabled,
           reset_threshold_balance,
           reset_target_balance,
           reset_cooldown_days,
           reset_notice
         )
         VALUES (1, $1, $2, $3, $3, $3, $4, FALSE, 20, 200, 7, $5)
         ON CONFLICT (id) DO NOTHING`,
        [
          config.DEFAULT_CHECKIN_ENABLED,
          false,
          config.DEFAULT_DAILY_REWARD,
          config.DEFAULT_TIMEZONE,
          '当当前余额低于阈值时，可直接补到目标值。'
        ]
      );
      return this.getSettings(client);
    }

    const row = result.rows[0];
    return {
      checkinEnabled: Boolean(row.checkin_enabled),
      blindboxEnabled: Boolean(row.blindbox_enabled),
      dailyRewardMinBalance: toNumber(
        row.daily_reward_min_balance ?? row.daily_reward_balance
      ),
      dailyRewardMaxBalance: toNumber(
        row.daily_reward_max_balance ?? row.daily_reward_balance
      ),
      timezone: String(row.timezone),
      resetEnabled: Boolean(row.reset_enabled),
      resetThresholdBalance: toNumber(row.reset_threshold_balance),
      resetTargetBalance: toNumber(row.reset_target_balance),
      resetCooldownDays: Number(row.reset_cooldown_days),
      resetNotice: String(row.reset_notice ?? '')
    };
  }

  async updateSettings(
    input: Partial<WelfareSettings>,
    client?: PoolClient
  ): Promise<WelfareSettings> {
    const executor = client ?? this.db;
    const current = await this.getSettings(client);
    const next = {
      checkinEnabled: input.checkinEnabled ?? current.checkinEnabled,
      blindboxEnabled: input.blindboxEnabled ?? current.blindboxEnabled,
      dailyRewardMinBalance:
        input.dailyRewardMinBalance ?? current.dailyRewardMinBalance,
      dailyRewardMaxBalance:
        input.dailyRewardMaxBalance ?? current.dailyRewardMaxBalance,
      timezone: input.timezone ?? current.timezone,
      resetEnabled: input.resetEnabled ?? current.resetEnabled,
      resetThresholdBalance:
        input.resetThresholdBalance ?? current.resetThresholdBalance,
      resetTargetBalance: input.resetTargetBalance ?? current.resetTargetBalance,
      resetCooldownDays: input.resetCooldownDays ?? current.resetCooldownDays,
      resetNotice: input.resetNotice ?? current.resetNotice
    };
    await executor.query(
      `UPDATE welfare_settings
       SET checkin_enabled = $1,
           blindbox_enabled = $2,
           daily_reward_balance = $3,
           daily_reward_min_balance = $4,
           daily_reward_max_balance = $5,
           timezone = $6,
           reset_enabled = $7,
           reset_threshold_balance = $8,
           reset_target_balance = $9,
           reset_cooldown_days = $10,
           reset_notice = $11,
           updated_at = NOW()
       WHERE id = 1`,
      [
        next.checkinEnabled,
        next.blindboxEnabled,
        next.dailyRewardMaxBalance,
        next.dailyRewardMinBalance,
        next.dailyRewardMaxBalance,
        next.timezone,
        next.resetEnabled,
        next.resetThresholdBalance,
        next.resetTargetBalance,
        next.resetCooldownDays,
        next.resetNotice
      ]
    );
    return next;
  }

  async listBlindboxItems(enabledOnly = false): Promise<BlindboxItem[]> {
    const conditions = enabledOnly ? 'WHERE enabled = TRUE' : '';
    const result = await this.db.query(
      `SELECT *
       FROM welfare_blindbox_items
       ${conditions}
       ORDER BY enabled DESC, sort_order ASC, reward_balance ASC, id ASC`
    );

    return result.rows.map((row) => this.mapBlindboxItem(row));
  }

  async getBlindboxItemById(id: number): Promise<BlindboxItem | null> {
    const result = await this.db.query(
      `SELECT *
       FROM welfare_blindbox_items
       WHERE id = $1
       LIMIT 1`,
      [id]
    );

    return result.rowCount ? this.mapBlindboxItem(result.rows[0]) : null;
  }

  async createBlindboxItem(input: CreateBlindboxItemInput): Promise<BlindboxItem> {
    const result = await this.db.query(
      `INSERT INTO welfare_blindbox_items (
         title,
         reward_balance,
         weight,
         enabled,
         notes,
         sort_order
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.title,
        input.rewardBalance,
        input.weight,
        input.enabled,
        input.notes,
        input.sortOrder
      ]
    );

    return this.mapBlindboxItem(result.rows[0]);
  }

  async updateBlindboxItem(
    id: number,
    input: UpdateBlindboxItemInput
  ): Promise<BlindboxItem | null> {
    const current = await this.getBlindboxItemById(id);
    if (!current) {
      return null;
    }

    const next = {
      title: input.title ?? current.title,
      rewardBalance: input.rewardBalance ?? current.rewardBalance,
      weight: input.weight ?? current.weight,
      enabled: input.enabled ?? current.enabled,
      notes: input.notes ?? current.notes,
      sortOrder: input.sortOrder ?? current.sortOrder
    };

    const result = await this.db.query(
      `UPDATE welfare_blindbox_items
       SET title = $2,
           reward_balance = $3,
           weight = $4,
           enabled = $5,
           notes = $6,
           sort_order = $7,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        next.title,
        next.rewardBalance,
        next.weight,
        next.enabled,
        next.notes,
        next.sortOrder
      ]
    );

    return result.rowCount ? this.mapBlindboxItem(result.rows[0]) : null;
  }

  async hasAdminUserId(sub2apiUserId: number): Promise<boolean> {
    const result = await this.db.query(
      `SELECT 1
       FROM welfare_admin_whitelist
       WHERE sub2api_user_id = $1
       LIMIT 1`,
      [sub2apiUserId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async hasLegacyAdminSubject(linuxdoSubject: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT 1
       FROM welfare_admin_whitelist
       WHERE linuxdo_subject = $1
         AND sub2api_user_id IS NULL
       LIMIT 1`,
      [linuxdoSubject]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listAdminWhitelist(): Promise<AdminWhitelistItem[]> {
    const result = await this.db.query(
      `SELECT id,
              sub2api_user_id,
              sub2api_email,
              sub2api_username,
              linuxdo_subject,
              notes,
              created_at
       FROM welfare_admin_whitelist
       ORDER BY id ASC`
    );
    return result.rows.map((row) => this.mapAdminWhitelistItem(row));
  }

  async addAdminWhitelist(input: CreateAdminWhitelistInput): Promise<AdminWhitelistItem> {
    return this.withTransaction(async (client) => {
      const existingByUserId = await client.query(
        `SELECT id
         FROM welfare_admin_whitelist
         WHERE sub2api_user_id = $1
         LIMIT 1
         FOR UPDATE`,
        [input.sub2apiUserId]
      );

      if ((existingByUserId.rowCount ?? 0) > 0) {
        const updated = await client.query(
          `UPDATE welfare_admin_whitelist
           SET sub2api_email = $2,
               sub2api_username = $3,
               linuxdo_subject = $4,
               notes = $5
           WHERE id = $1
           RETURNING id,
                     sub2api_user_id,
                     sub2api_email,
                     sub2api_username,
                     linuxdo_subject,
                     notes,
                     created_at`,
          [
            Number(existingByUserId.rows[0]?.id),
            input.email,
            input.username,
            input.linuxdoSubject,
            input.notes
          ]
        );

        return this.mapAdminWhitelistItem(updated.rows[0]);
      }

      if (input.linuxdoSubject) {
        const existingBySubject = await client.query(
          `SELECT id
           FROM welfare_admin_whitelist
           WHERE linuxdo_subject = $1
           LIMIT 1
           FOR UPDATE`,
          [input.linuxdoSubject]
        );

        if ((existingBySubject.rowCount ?? 0) > 0) {
          const updated = await client.query(
            `UPDATE welfare_admin_whitelist
             SET sub2api_user_id = $2,
                 sub2api_email = $3,
                 sub2api_username = $4,
                 linuxdo_subject = $5,
                 notes = $6
             WHERE id = $1
             RETURNING id,
                       sub2api_user_id,
                       sub2api_email,
                       sub2api_username,
                       linuxdo_subject,
                       notes,
                       created_at`,
            [
              Number(existingBySubject.rows[0]?.id),
              input.sub2apiUserId,
              input.email,
              input.username,
              input.linuxdoSubject,
              input.notes
            ]
          );

          return this.mapAdminWhitelistItem(updated.rows[0]);
        }
      }

      const inserted = await client.query(
        `INSERT INTO welfare_admin_whitelist (
           sub2api_user_id,
           sub2api_email,
           sub2api_username,
           linuxdo_subject,
           notes
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id,
                   sub2api_user_id,
                   sub2api_email,
                   sub2api_username,
                   linuxdo_subject,
                   notes,
                   created_at`,
        [
          input.sub2apiUserId,
          input.email,
          input.username,
          input.linuxdoSubject,
          input.notes
        ]
      );

      return this.mapAdminWhitelistItem(inserted.rows[0]);
    });
  }

  async removeAdminWhitelist(id: number): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM welfare_admin_whitelist WHERE id = $1`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async bootstrapLegacyAdminWhitelist(subjects: string[]): Promise<void> {
    if (subjects.length === 0) return;
    for (const subject of subjects) {
      await this.db.query(
        `INSERT INTO welfare_admin_whitelist (
           linuxdo_subject,
           notes
         )
         VALUES ($1, $2)
         ON CONFLICT (linuxdo_subject) DO NOTHING`,
        [subject, 'bootstrap']
      );
    }
  }

  async bootstrapAdminWhitelist(userIds: number[]): Promise<void> {
    if (userIds.length === 0) return;
    for (const userId of userIds) {
      await this.db.query(
        `INSERT INTO welfare_admin_whitelist (
           sub2api_user_id,
           sub2api_email,
           sub2api_username,
           notes
         )
         SELECT $1, '', '', 'bootstrap'
         WHERE NOT EXISTS (
           SELECT 1
           FROM welfare_admin_whitelist
           WHERE sub2api_user_id = $1
         )`,
        [userId]
      );
    }
  }

  async updateAdminWhitelistIdentity(
    id: number,
    input: {
      sub2apiUserId: number;
      email: string;
      username: string;
      linuxdoSubject: string | null;
    }
  ): Promise<void> {
    await this.db.query(
      `UPDATE welfare_admin_whitelist
       SET sub2api_user_id = $2,
           sub2api_email = $3,
           sub2api_username = $4,
           linuxdo_subject = $5
       WHERE id = $1`,
      [
        id,
        input.sub2apiUserId,
        input.email,
        input.username,
        input.linuxdoSubject
      ]
    );
  }

  async getCheckinByDate(
    sub2apiUserId: number,
    checkinDate: string
  ): Promise<CheckinRecord | null> {
    const result = await this.db.query(
      `SELECT *
       FROM welfare_checkins
       WHERE sub2api_user_id = $1 AND checkin_date = $2
       LIMIT 1`,
      [sub2apiUserId, checkinDate]
    );
    return result.rowCount ? this.mapCheckin(result.rows[0]) : null;
  }

  async getCheckinById(id: number): Promise<CheckinRecord | null> {
    const result = await this.db.query(
      `SELECT *
       FROM welfare_checkins
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    return result.rowCount ? this.mapCheckin(result.rows[0]) : null;
  }

  async createCheckinPending(input: CreateCheckinInput): Promise<CheckinRecord | null> {
    const result = await this.db.query(
      `INSERT INTO welfare_checkins (
         sub2api_user_id,
         sub2api_email,
         sub2api_username,
         linuxdo_subject,
         checkin_date,
         checkin_mode,
         blindbox_item_id,
         blindbox_title,
         reward_balance,
         idempotency_key,
         grant_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       ON CONFLICT (sub2api_user_id, checkin_date) DO NOTHING
       RETURNING *`,
      [
        input.sub2apiUserId,
        input.sub2apiEmail,
        input.sub2apiUsername,
        input.linuxdoSubject,
        input.checkinDate,
        input.checkinMode,
        input.blindboxItemId ?? null,
        input.blindboxTitle ?? '',
        input.rewardBalance,
        input.idempotencyKey
      ]
    );
    return result.rowCount ? this.mapCheckin(result.rows[0]) : null;
  }

  async markCheckinPendingRetry(
    id: number
  ): Promise<CheckinRecord | null> {
    const result = await this.db.query(
      `UPDATE welfare_checkins
       SET grant_status = 'pending',
           grant_error = '',
           sub2api_request_id = '',
           updated_at = NOW()
       WHERE id = $1 AND grant_status = 'failed'
       RETURNING *`,
      [id]
    );
    return result.rowCount ? this.mapCheckin(result.rows[0]) : null;
  }

  async claimStalePending(
    id: number,
    staleAfterMs: number
  ): Promise<CheckinRecord | null> {
    const result = await this.db.query(
      `UPDATE welfare_checkins
       SET updated_at = NOW()
       WHERE id = $1
         AND grant_status = 'pending'
         AND updated_at <= NOW() - ($2::int * INTERVAL '1 millisecond')
       RETURNING *`,
      [id, staleAfterMs]
    );
    return result.rowCount ? this.mapCheckin(result.rows[0]) : null;
  }

  async markCheckinSuccess(
    id: number,
    requestId: string
  ): Promise<void> {
    await this.db.query(
      `UPDATE welfare_checkins
       SET grant_status = 'success',
           grant_error = '',
           sub2api_request_id = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [id, requestId]
    );
  }

  async markCheckinFailed(id: number, errorText: string): Promise<void> {
    await this.db.query(
      `UPDATE welfare_checkins
       SET grant_status = 'failed',
           grant_error = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [id, errorText]
    );
  }

  async listUserCheckins(
    sub2apiUserId: number,
    limit = 30
  ): Promise<CheckinRecord[]> {
    const result = await this.db.query(
      `SELECT *
       FROM welfare_checkins
       WHERE sub2api_user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sub2apiUserId, limit]
    );
    return result.rows.map((row) => this.mapCheckin(row));
  }

  async queryAdminCheckins(params: {
    page: number;
    pageSize: number;
    dateFrom?: string;
    dateTo?: string;
    grantStatus?: string;
    subject?: string;
  }): Promise<{ items: CheckinRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.dateFrom) {
      values.push(params.dateFrom);
      conditions.push(`checkin_date >= $${values.length}`);
    }
    if (params.dateTo) {
      values.push(params.dateTo);
      conditions.push(`checkin_date <= $${values.length}`);
    }
    if (params.grantStatus) {
      values.push(params.grantStatus);
      conditions.push(`grant_status = $${values.length}`);
    }
    if (params.subject) {
      values.push(`%${params.subject}%`);
      conditions.push(
        `(COALESCE(linuxdo_subject, '') ILIKE $${values.length}
          OR sub2api_email ILIKE $${values.length}
          OR sub2api_username ILIKE $${values.length})`
      );
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (params.page - 1) * params.pageSize;

    const totalResult = await this.db.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM welfare_checkins ${whereClause}`,
      values
    );
    values.push(params.pageSize);
    values.push(offset);
    const listResult = await this.db.query(
      `SELECT *
       FROM welfare_checkins
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1}
       OFFSET $${values.length}`,
      values
    );

    return {
      items: listResult.rows.map((row) => this.mapCheckin(row)),
      total: Number(totalResult.rows[0]?.total ?? 0)
    };
  }

  async getLatestUserResetRecord(
    sub2apiUserId: number,
    client?: PoolClient
  ): Promise<ResetRecord | null> {
    const executor = client ?? this.db;
    const result = await executor.query(
      `SELECT *
       FROM welfare_reset_records
       WHERE sub2api_user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [sub2apiUserId]
    );
    return result.rowCount ? this.mapResetRecord(result.rows[0]) : null;
  }

  async getLatestUserSuccessfulReset(
    sub2apiUserId: number,
    client?: PoolClient
  ): Promise<ResetRecord | null> {
    const executor = client ?? this.db;
    const result = await executor.query(
      `SELECT *
       FROM welfare_reset_records
       WHERE sub2api_user_id = $1
         AND grant_status = 'success'
       ORDER BY created_at DESC
       LIMIT 1`,
      [sub2apiUserId]
    );
    return result.rowCount ? this.mapResetRecord(result.rows[0]) : null;
  }

  async createResetPending(
    input: CreateResetRecordInput,
    client?: PoolClient
  ): Promise<ResetRecord> {
    const executor = client ?? this.db;
    const result = await executor.query(
      `INSERT INTO welfare_reset_records (
         sub2api_user_id,
         sub2api_email,
         sub2api_username,
         linuxdo_subject,
         before_balance,
         threshold_balance,
         target_balance,
         granted_balance,
         cooldown_days,
         idempotency_key,
         grant_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       RETURNING *`,
      [
        input.sub2apiUserId,
        input.sub2apiEmail,
        input.sub2apiUsername,
        input.linuxdoSubject,
        input.beforeBalance,
        input.thresholdBalance,
        input.targetBalance,
        input.grantedBalance,
        input.cooldownDays,
        input.idempotencyKey
      ]
    );

    return this.mapResetRecord(result.rows[0]);
  }

  async markResetSuccess(
    id: number,
    requestId: string,
    newBalance: number | null,
    client?: PoolClient
  ): Promise<void> {
    const executor = client ?? this.db;
    await executor.query(
      `UPDATE welfare_reset_records
       SET grant_status = 'success',
           grant_error = '',
           sub2api_request_id = $2,
           new_balance = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [id, requestId, newBalance]
    );
  }

  async markResetFailed(
    id: number,
    errorText: string,
    client?: PoolClient
  ): Promise<void> {
    const executor = client ?? this.db;
    await executor.query(
      `UPDATE welfare_reset_records
       SET grant_status = 'failed',
           grant_error = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [id, errorText]
    );
  }

  async listUserResetRecords(
    sub2apiUserId: number,
    limit = 20,
    client?: PoolClient
  ): Promise<ResetRecord[]> {
    const executor = client ?? this.db;
    const result = await executor.query(
      `SELECT *
       FROM welfare_reset_records
       WHERE sub2api_user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sub2apiUserId, limit]
    );
    return result.rows.map((row) => this.mapResetRecord(row));
  }

  async queryAdminResetRecords(params: {
    page: number;
    pageSize: number;
    dateFrom?: string;
    dateTo?: string;
    grantStatus?: string;
    subject?: string;
  }): Promise<{ items: ResetRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.dateFrom) {
      values.push(params.dateFrom);
      conditions.push(`created_at >= $${values.length}::date`);
    }
    if (params.dateTo) {
      values.push(params.dateTo);
      conditions.push(`created_at < ($${values.length}::date + INTERVAL '1 day')`);
    }
    if (params.grantStatus) {
      values.push(params.grantStatus);
      conditions.push(`grant_status = $${values.length}`);
    }
    if (params.subject) {
      values.push(`%${params.subject}%`);
      conditions.push(
        `(COALESCE(linuxdo_subject, '') ILIKE $${values.length}
          OR sub2api_email ILIKE $${values.length}
          OR sub2api_username ILIKE $${values.length})`
      );
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (params.page - 1) * params.pageSize;

    const totalResult = await this.db.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM welfare_reset_records
       ${whereClause}`,
      values
    );

    values.push(params.pageSize);
    values.push(offset);
    const listResult = await this.db.query(
      `SELECT *
       FROM welfare_reset_records
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1}
       OFFSET $${values.length}`,
      values
    );

    return {
      items: listResult.rows.map((row) => this.mapResetRecord(row)),
      total: Number(totalResult.rows[0]?.total ?? 0)
    };
  }

  async getUserActivitySummaryMap(
    userIds: number[],
    client?: PoolClient
  ): Promise<Map<number, UserActivitySummary>> {
    const summaryMap = new Map<number, UserActivitySummary>();
    userIds.forEach((userId) => {
      summaryMap.set(userId, {
        sub2apiUserId: userId,
        checkinCount: 0,
        redeemCount: 0,
        resetCount: 0
      });
    });

    if (userIds.length === 0) {
      return summaryMap;
    }

    const executor = client ?? this.db;
    const [checkinRows, redeemRows, resetRows] = await Promise.all([
      executor.query(
        `SELECT sub2api_user_id, COUNT(*)::int AS total
         FROM welfare_checkins
         WHERE sub2api_user_id = ANY($1::bigint[])
         GROUP BY sub2api_user_id`,
        [userIds]
      ),
      executor.query(
        `SELECT sub2api_user_id, COUNT(*)::int AS total
         FROM welfare_redeem_claims
         WHERE sub2api_user_id = ANY($1::bigint[])
         GROUP BY sub2api_user_id`,
        [userIds]
      ),
      executor.query(
        `SELECT sub2api_user_id, COUNT(*)::int AS total
         FROM welfare_reset_records
         WHERE sub2api_user_id = ANY($1::bigint[])
         GROUP BY sub2api_user_id`,
        [userIds]
      )
    ]);

    checkinRows.rows.forEach((row) => {
      const userId = Number(row.sub2api_user_id);
      const current = summaryMap.get(userId);
      if (current) {
        current.checkinCount = Number(row.total);
      }
    });
    redeemRows.rows.forEach((row) => {
      const userId = Number(row.sub2api_user_id);
      const current = summaryMap.get(userId);
      if (current) {
        current.redeemCount = Number(row.total);
      }
    });
    resetRows.rows.forEach((row) => {
      const userId = Number(row.sub2api_user_id);
      const current = summaryMap.get(userId);
      if (current) {
        current.resetCount = Number(row.total);
      }
    });

    return summaryMap;
  }

  async createUserCleanupLog(
    input: CreateUserCleanupLogInput,
    client?: PoolClient
  ): Promise<void> {
    const executor = client ?? this.db;
    await executor.query(
      `INSERT INTO welfare_user_cleanup_logs (
         operator_sub2api_user_id,
         operator_email,
         operator_username,
         target_sub2api_user_id,
         target_email,
         target_username,
         target_balance,
         result_status,
         detail
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.operatorSub2apiUserId,
        input.operatorEmail,
        input.operatorUsername,
        input.targetSub2apiUserId,
        input.targetEmail,
        input.targetUsername,
        input.targetBalance,
        input.resultStatus,
        input.detail
      ]
    );
  }

  async getDailyStats(startDate: string): Promise<
    Array<{
      checkinDate: string;
      checkinUsers: number;
      grantTotal: number;
    }>
  > {
    const result = await this.db.query(
      `SELECT checkin_date,
              COUNT(*)::int AS checkin_users,
              COALESCE(SUM(reward_balance), 0)::text AS grant_total
       FROM welfare_checkins
       WHERE grant_status = 'success'
         AND checkin_date >= $1::date
       GROUP BY checkin_date
       ORDER BY checkin_date ASC`,
      [startDate]
    );

    return result.rows.map((row) => ({
      checkinDate: String(row.checkin_date),
      checkinUsers: Number(row.checkin_users),
      grantTotal: toNumber(row.grant_total)
    }));
  }

  async getActiveUserCount(startDate: string): Promise<number> {
    const result = await this.db.query<{ total: string }>(
      `SELECT COUNT(DISTINCT sub2api_user_id)::text AS total
       FROM welfare_checkins
       WHERE grant_status = 'success'
         AND checkin_date >= $1::date`,
      [startDate]
    );

    return Number(result.rows[0]?.total ?? 0);
  }

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

  private mapBlindboxItem(row: Record<string, unknown>): BlindboxItem {
    return {
      id: Number(row.id),
      title: String(row.title),
      rewardBalance: toNumber(row.reward_balance),
      weight: Number(row.weight),
      enabled: Boolean(row.enabled),
      notes: String(row.notes ?? ''),
      sortOrder: Number(row.sort_order ?? 0),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at ?? row.created_at)
    };
  }

  private mapAdminWhitelistItem(row: Record<string, unknown>): AdminWhitelistItem {
    return {
      id: Number(row.id),
      sub2apiUserId:
        row.sub2api_user_id == null ? null : Number(row.sub2api_user_id),
      email: String(row.sub2api_email ?? ''),
      username: String(row.sub2api_username ?? ''),
      linuxdoSubject:
        typeof row.linuxdo_subject === 'string' && row.linuxdo_subject.trim() !== ''
          ? String(row.linuxdo_subject)
          : null,
      notes: String(row.notes ?? ''),
      createdAt: String(row.created_at)
    };
  }

  private mapCheckin(row: Record<string, unknown>): CheckinRecord {
    return {
      id: Number(row.id),
      sub2apiUserId: Number(row.sub2api_user_id),
      sub2apiEmail: String(row.sub2api_email ?? ''),
      sub2apiUsername: String(row.sub2api_username ?? ''),
      linuxdoSubject:
        typeof row.linuxdo_subject === 'string' && row.linuxdo_subject.trim() !== ''
          ? String(row.linuxdo_subject)
          : null,
      checkinDate: String(row.checkin_date),
      checkinMode:
        row.checkin_mode === 'blindbox' ? 'blindbox' : 'normal',
      blindboxItemId:
        row.blindbox_item_id == null ? null : Number(row.blindbox_item_id),
      blindboxTitle: String(row.blindbox_title ?? ''),
      rewardBalance: toNumber(row.reward_balance),
      idempotencyKey: String(row.idempotency_key),
      grantStatus: String(row.grant_status) as CheckinRecord['grantStatus'],
      grantError: String(row.grant_error ?? ''),
      sub2apiRequestId: String(row.sub2api_request_id ?? ''),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at ?? row.created_at)
    };
  }

  private mapResetRecord(row: Record<string, unknown>): ResetRecord {
    return {
      id: Number(row.id),
      sub2apiUserId: Number(row.sub2api_user_id),
      sub2apiEmail: String(row.sub2api_email ?? ''),
      sub2apiUsername: String(row.sub2api_username ?? ''),
      linuxdoSubject:
        typeof row.linuxdo_subject === 'string' && row.linuxdo_subject.trim() !== ''
          ? String(row.linuxdo_subject)
          : null,
      beforeBalance: toNumber(row.before_balance),
      thresholdBalance: toNumber(row.threshold_balance),
      targetBalance: toNumber(row.target_balance),
      grantedBalance: toNumber(row.granted_balance),
      newBalance:
        row.new_balance == null ? null : toNumber(row.new_balance),
      cooldownDays: Number(row.cooldown_days ?? 0),
      idempotencyKey: String(row.idempotency_key),
      grantStatus: String(row.grant_status) as ResetRecord['grantStatus'],
      grantError: String(row.grant_error ?? ''),
      sub2apiRequestId: String(row.sub2api_request_id ?? ''),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at ?? row.created_at)
    };
  }
}

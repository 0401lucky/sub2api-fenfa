import type { Pool, PoolClient, QueryResult } from 'pg';
import type { RedeemClaim, RedeemCode } from '../types/domain.js';

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  throw new Error(`无法转换数值: ${String(value)}`);
}

type DbLike = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export interface CreateRedeemCodeInput {
  code: string;
  title: string;
  rewardBalance: number;
  maxClaims: number;
  enabled: boolean;
  expiresAt: string | null;
  notes: string;
}

export interface UpdateRedeemCodeInput {
  title?: string;
  enabled?: boolean;
  expiresAt?: string | null;
  notes?: string;
}

export interface CreateRedeemClaimInput {
  redeemCodeId: number;
  sub2apiUserId: number;
  linuxdoSubject: string;
  syntheticEmail: string;
  redeemCode: string;
  redeemTitle: string;
  rewardBalance: number;
  idempotencyKey: string;
}

export class RedeemRepository {
  constructor(private readonly db: Pool) {}

  private async query<T extends Record<string, unknown>>(
    db: DbLike,
    sql: string,
    values: unknown[] = []
  ): Promise<QueryResult<T>> {
    return db.query<T>(sql, values);
  }

  async listRedeemCodes(): Promise<RedeemCode[]> {
    const result = await this.db.query(
      `SELECT *
       FROM welfare_redeem_codes
       ORDER BY created_at DESC, id DESC`
    );
    return result.rows.map((row) => this.mapRedeemCode(row));
  }

  async getRedeemCodeById(id: number): Promise<RedeemCode | null> {
    const result = await this.db.query(
      `SELECT *
       FROM welfare_redeem_codes
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    return result.rowCount ? this.mapRedeemCode(result.rows[0]) : null;
  }

  async getRedeemCodeByCodeForUpdate(
    code: string,
    db: PoolClient
  ): Promise<RedeemCode | null> {
    const result = await this.query(
      db,
      `SELECT *
       FROM welfare_redeem_codes
       WHERE code = $1
       LIMIT 1
       FOR UPDATE`,
      [code]
    );
    return result.rowCount ? this.mapRedeemCode(result.rows[0]) : null;
  }

  async createRedeemCode(input: CreateRedeemCodeInput): Promise<RedeemCode> {
    const result = await this.db.query(
      `INSERT INTO welfare_redeem_codes (
         code,
         title,
         reward_balance,
         max_claims,
         claimed_count,
         enabled,
         expires_at,
         notes
       )
       VALUES ($1, $2, $3, $4, 0, $5, $6, $7)
       RETURNING *`,
      [
        input.code,
        input.title,
        input.rewardBalance,
        input.maxClaims,
        input.enabled,
        input.expiresAt,
        input.notes
      ]
    );
    return this.mapRedeemCode(result.rows[0]);
  }

  async updateRedeemCode(
    id: number,
    input: UpdateRedeemCodeInput
  ): Promise<RedeemCode | null> {
    const current = await this.getRedeemCodeById(id);
    if (!current) {
      return null;
    }

    const next = {
      title: input.title ?? current.title,
      enabled: input.enabled ?? current.enabled,
      expiresAt: input.expiresAt === undefined ? current.expiresAt : input.expiresAt,
      notes: input.notes ?? current.notes
    };

    const result = await this.db.query(
      `UPDATE welfare_redeem_codes
       SET title = $2,
           enabled = $3,
           expires_at = $4,
           notes = $5,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, next.title, next.enabled, next.expiresAt, next.notes]
    );
    return result.rowCount ? this.mapRedeemCode(result.rows[0]) : null;
  }

  async incrementRedeemCodeClaimedCount(
    id: number,
    db: PoolClient
  ): Promise<RedeemCode | null> {
    const result = await this.query(
      db,
      `UPDATE welfare_redeem_codes
       SET claimed_count = claimed_count + 1,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rowCount ? this.mapRedeemCode(result.rows[0]) : null;
  }

  async getRedeemClaimById(
    id: number,
    db: DbLike = this.db
  ): Promise<RedeemClaim | null> {
    const result = await this.query(
      db,
      `SELECT *
       FROM welfare_redeem_claims
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    return result.rowCount ? this.mapRedeemClaim(result.rows[0]) : null;
  }

  async getRedeemClaimByIdForUpdate(
    id: number,
    db: PoolClient
  ): Promise<RedeemClaim | null> {
    const result = await this.query(
      db,
      `SELECT *
       FROM welfare_redeem_claims
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [id]
    );
    return result.rowCount ? this.mapRedeemClaim(result.rows[0]) : null;
  }

  async getRedeemClaimByCodeAndUser(
    redeemCodeId: number,
    sub2apiUserId: number,
    db: DbLike = this.db
  ): Promise<RedeemClaim | null> {
    const result = await this.query(
      db,
      `SELECT *
       FROM welfare_redeem_claims
       WHERE redeem_code_id = $1 AND sub2api_user_id = $2
       LIMIT 1`,
      [redeemCodeId, sub2apiUserId]
    );
    return result.rowCount ? this.mapRedeemClaim(result.rows[0]) : null;
  }

  async createRedeemClaimPending(
    input: CreateRedeemClaimInput,
    db: DbLike = this.db
  ): Promise<RedeemClaim | null> {
    const result = await this.query(
      db,
      `INSERT INTO welfare_redeem_claims (
         redeem_code_id,
         sub2api_user_id,
         linuxdo_subject,
         synthetic_email,
         redeem_code,
         redeem_title,
         reward_balance,
         idempotency_key,
         grant_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       ON CONFLICT (redeem_code_id, sub2api_user_id) DO NOTHING
       RETURNING *`,
      [
        input.redeemCodeId,
        input.sub2apiUserId,
        input.linuxdoSubject,
        input.syntheticEmail,
        input.redeemCode,
        input.redeemTitle,
        input.rewardBalance,
        input.idempotencyKey
      ]
    );
    return result.rowCount ? this.mapRedeemClaim(result.rows[0]) : null;
  }

  async markRedeemClaimPendingRetry(
    id: number,
    db: DbLike = this.db
  ): Promise<RedeemClaim | null> {
    const result = await this.query(
      db,
      `UPDATE welfare_redeem_claims
       SET grant_status = 'pending',
           grant_error = '',
           sub2api_request_id = '',
           updated_at = NOW()
       WHERE id = $1 AND grant_status = 'failed'
       RETURNING *`,
      [id]
    );
    return result.rowCount ? this.mapRedeemClaim(result.rows[0]) : null;
  }

  async claimStaleRedeemPending(
    id: number,
    staleAfterMs: number,
    db: DbLike = this.db
  ): Promise<RedeemClaim | null> {
    const result = await this.query(
      db,
      `UPDATE welfare_redeem_claims
       SET updated_at = NOW()
       WHERE id = $1
         AND grant_status = 'pending'
         AND updated_at <= NOW() - ($2::int * INTERVAL '1 millisecond')
       RETURNING *`,
      [id, staleAfterMs]
    );
    return result.rowCount ? this.mapRedeemClaim(result.rows[0]) : null;
  }

  async markRedeemClaimSuccess(id: number, requestId: string): Promise<void> {
    await this.db.query(
      `UPDATE welfare_redeem_claims
       SET grant_status = 'success',
           grant_error = '',
           sub2api_request_id = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [id, requestId]
    );
  }

  async markRedeemClaimFailed(id: number, errorText: string): Promise<void> {
    await this.db.query(
      `UPDATE welfare_redeem_claims
       SET grant_status = 'failed',
           grant_error = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [id, errorText]
    );
  }

  async listUserRedeemClaims(
    sub2apiUserId: number,
    limit = 30
  ): Promise<RedeemClaim[]> {
    const result = await this.db.query(
      `SELECT *
       FROM welfare_redeem_claims
       WHERE sub2api_user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sub2apiUserId, limit]
    );
    return result.rows.map((row) => this.mapRedeemClaim(row));
  }

  async queryAdminRedeemClaims(params: {
    page: number;
    pageSize: number;
    grantStatus?: string;
    subject?: string;
    code?: string;
  }): Promise<{ items: RedeemClaim[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.grantStatus) {
      values.push(params.grantStatus);
      conditions.push(`grant_status = $${values.length}`);
    }
    if (params.subject) {
      values.push(`%${params.subject}%`);
      conditions.push(`linuxdo_subject ILIKE $${values.length}`);
    }
    if (params.code) {
      values.push(`%${params.code}%`);
      conditions.push(`redeem_code ILIKE $${values.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (params.page - 1) * params.pageSize;

    const totalResult = await this.db.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM welfare_redeem_claims
       ${whereClause}`,
      values
    );

    values.push(params.pageSize);
    values.push(offset);
    const listResult = await this.db.query(
      `SELECT *
       FROM welfare_redeem_claims
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1}
       OFFSET $${values.length}`,
      values
    );

    return {
      items: listResult.rows.map((row) => this.mapRedeemClaim(row)),
      total: Number(totalResult.rows[0]?.total ?? 0)
    };
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

  private mapRedeemCode(row: Record<string, unknown>): RedeemCode {
    return {
      id: Number(row.id),
      code: String(row.code),
      title: String(row.title),
      rewardBalance: toNumber(row.reward_balance),
      maxClaims: Number(row.max_claims),
      claimedCount: Number(row.claimed_count),
      enabled: Boolean(row.enabled),
      expiresAt: row.expires_at ? String(row.expires_at) : null,
      notes: String(row.notes ?? ''),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at ?? row.created_at)
    };
  }

  private mapRedeemClaim(row: Record<string, unknown>): RedeemClaim {
    return {
      id: Number(row.id),
      redeemCodeId: Number(row.redeem_code_id),
      sub2apiUserId: Number(row.sub2api_user_id),
      linuxdoSubject: String(row.linuxdo_subject),
      syntheticEmail: String(row.synthetic_email),
      redeemCode: String(row.redeem_code),
      redeemTitle: String(row.redeem_title),
      rewardBalance: toNumber(row.reward_balance),
      idempotencyKey: String(row.idempotency_key),
      grantStatus: String(row.grant_status) as RedeemClaim['grantStatus'],
      grantError: String(row.grant_error ?? ''),
      sub2apiRequestId: String(row.sub2api_request_id ?? ''),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at ?? row.created_at)
    };
  }
}

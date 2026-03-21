import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { pool } from '../db.js';
import {
  RedeemRepository,
  type CreateRedeemCodeInput,
  type UpdateRedeemCodeInput
} from '../repositories/redeem-repository.js';
import type { RedeemClaim, RedeemCode, SessionUser } from '../types/domain.js';
import { Sub2apiClient, sub2apiClient } from './sub2api-client.js';

export class ConflictError extends Error {}
export class ForbiddenError extends Error {}
export class NotFoundError extends Error {}

const PENDING_RECOVERY_AFTER_MS = Math.max(30_000, config.SUB2API_TIMEOUT_MS * 2);

function normalizeRedeemCode(rawCode: string): string {
  return rawCode.trim().toUpperCase();
}

function buildIdempotencyKey(redeemCodeId: number, sub2apiUserId: number): string {
  return `welfare-redeem:${redeemCodeId}:${sub2apiUserId}`;
}

function buildGrantNotes(record: RedeemClaim): string {
  return `福利兑换码 ${record.redeemTitle || record.redeemCode}`;
}

function isRedeemCodeExpired(code: Pick<RedeemCode, 'expiresAt'>): boolean {
  if (!code.expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(code.expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }

  return expiresAtMs <= Date.now();
}

function isPendingRecoverable(record: Pick<RedeemClaim, 'grantStatus' | 'updatedAt'>): boolean {
  if (record.grantStatus !== 'pending') {
    return false;
  }

  const updatedAtMs = Date.parse(record.updatedAt);
  if (Number.isNaN(updatedAtMs)) {
    return true;
  }

  return Date.now() - updatedAtMs >= PENDING_RECOVERY_AFTER_MS;
}

function isPgUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

const repository = new RedeemRepository(pool);

type RedeemRepositoryLike = Pick<
  RedeemRepository,
  | 'withTransaction'
  | 'getRedeemCodeByCodeForUpdate'
  | 'getRedeemCodeById'
  | 'createRedeemCode'
  | 'updateRedeemCode'
  | 'listRedeemCodes'
  | 'getRedeemClaimById'
  | 'getRedeemClaimByIdForUpdate'
  | 'getRedeemClaimByCodeAndUser'
  | 'createRedeemClaimPending'
  | 'incrementRedeemCodeClaimedCount'
  | 'markRedeemClaimPendingRetry'
  | 'claimStaleRedeemPending'
  | 'markRedeemClaimSuccess'
  | 'markRedeemClaimFailed'
  | 'listUserRedeemClaims'
  | 'queryAdminRedeemClaims'
>;

type Sub2apiClientLike = Pick<Sub2apiClient, 'addUserBalance'>;

export class RedeemService {
  constructor(
    private readonly repository: RedeemRepositoryLike,
    private readonly sub2api: Sub2apiClientLike
  ) {}

  async redeem(user: SessionUser, rawCode: string) {
    const code = normalizeRedeemCode(rawCode);
    const { claim } = await this.repository.withTransaction(async (tx) => {
      const redeemCode = await this.repository.getRedeemCodeByCodeForUpdate(code, tx);
      if (!redeemCode) {
        throw new NotFoundError('兑换码不存在');
      }

      const existing = await this.repository.getRedeemClaimByCodeAndUser(
        redeemCode.id,
        user.sub2apiUserId,
        tx
      );

      if (existing) {
        const pending = await this.claimRetryableRedeem(existing, tx, '你已领取过该兑换码');
        return { claim: pending };
      }

      if (!redeemCode.enabled) {
        throw new ForbiddenError('兑换码已停用');
      }

      if (isRedeemCodeExpired(redeemCode)) {
        throw new ForbiddenError('兑换码已过期');
      }

      if (redeemCode.claimedCount >= redeemCode.maxClaims) {
        throw new ConflictError('兑换码已领完');
      }

      const claim = await this.repository.createRedeemClaimPending(
        {
          redeemCodeId: redeemCode.id,
          sub2apiUserId: user.sub2apiUserId,
          linuxdoSubject: user.linuxdoSubject,
          syntheticEmail: user.syntheticEmail,
          redeemCode: redeemCode.code,
          redeemTitle: redeemCode.title,
          rewardBalance: redeemCode.rewardBalance,
          idempotencyKey: buildIdempotencyKey(redeemCode.id, user.sub2apiUserId)
        },
        tx
      );

      if (!claim) {
        throw new ConflictError('兑换处理中，请稍后刷新');
      }

      await this.repository.incrementRedeemCodeClaimedCount(redeemCode.id, tx);
      return { claim };
    });

    const grantResult = await this.grantRedeem(claim);
    return {
      claim_id: claim.id,
      code: claim.redeemCode,
      title: claim.redeemTitle,
      reward_balance: claim.rewardBalance,
      new_balance: grantResult.newBalance,
      grant_status: 'success' as const
    };
  }

  async getHistory(user: SessionUser, limit = 30) {
    const records = await this.repository.listUserRedeemClaims(user.sub2apiUserId, limit);
    return records.map((item) => ({
      id: item.id,
      redeem_code_id: item.redeemCodeId,
      redeem_code: item.redeemCode,
      redeem_title: item.redeemTitle,
      reward_balance: item.rewardBalance,
      grant_status: item.grantStatus,
      grant_error: item.grantError,
      created_at: item.createdAt
    }));
  }

  async createAdminRedeemCode(input: CreateRedeemCodeInput) {
    try {
      return await this.repository.createRedeemCode({
        ...input,
        code: normalizeRedeemCode(input.code)
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new ConflictError('兑换码已存在');
      }
      throw error;
    }
  }

  async listAdminRedeemCodes() {
    return this.repository.listRedeemCodes();
  }

  async updateAdminRedeemCode(id: number, input: UpdateRedeemCodeInput) {
    const updated = await this.repository.updateRedeemCode(id, input);
    if (!updated) {
      throw new NotFoundError('兑换码不存在');
    }
    return updated;
  }

  async getAdminRedeemClaims(params: {
    page: number;
    pageSize: number;
    grantStatus?: string;
    subject?: string;
    code?: string;
  }) {
    return this.repository.queryAdminRedeemClaims(params);
  }

  async retryRedeemClaim(id: number) {
    const claim = await this.repository.withTransaction(async (tx) => {
      const current = await this.repository.getRedeemClaimByIdForUpdate(id, tx);
      if (!current) {
        throw new NotFoundError('兑换记录不存在');
      }

      return this.claimRetryableRedeem(current, tx, '该兑换记录已发放成功');
    });

    const grantResult = await this.grantRedeem(claim);
    const updated = await this.repository.getRedeemClaimById(claim.id);
    if (!updated) {
      throw new Error('兑换记录读取失败，请稍后重试');
    }

    return {
      item: updated,
      new_balance: grantResult.newBalance
    };
  }

  private async claimRetryableRedeem(
    existing: RedeemClaim,
    tx: PoolClient,
    successConflictMessage: string
  ): Promise<RedeemClaim> {
    if (existing.grantStatus === 'success') {
      throw new ConflictError(successConflictMessage);
    }

    if (existing.grantStatus === 'failed') {
      const pending = await this.repository.markRedeemClaimPendingRetry(existing.id, tx);
      if (!pending) {
        throw new ConflictError('兑换处理中，请稍后刷新');
      }
      return pending;
    }

    if (!isPendingRecoverable(existing)) {
      throw new ConflictError('兑换处理中，请稍后刷新');
    }

    const pending = await this.repository.claimStaleRedeemPending(
      existing.id,
      PENDING_RECOVERY_AFTER_MS,
      tx
    );
    if (!pending) {
      throw new ConflictError('兑换处理中，请稍后刷新');
    }

    return pending;
  }

  private async grantRedeem(record: RedeemClaim) {
    let grantResult: Awaited<ReturnType<Sub2apiClientLike['addUserBalance']>>;

    try {
      grantResult = await this.sub2api.addUserBalance({
        userId: record.sub2apiUserId,
        amount: record.rewardBalance,
        notes: buildGrantNotes(record),
        idempotencyKey: record.idempotencyKey
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      try {
        await this.repository.markRedeemClaimFailed(record.id, message.slice(0, 500));
      } catch (markFailedError) {
        console.error('[redeem] 回写失败状态异常', markFailedError);
      }
      throw error;
    }

    await this.repository.markRedeemClaimSuccess(record.id, grantResult.requestId);
    return {
      newBalance: grantResult.newBalance ?? null,
      requestId: grantResult.requestId
    };
  }
}

export const redeemService = new RedeemService(repository, sub2apiClient);

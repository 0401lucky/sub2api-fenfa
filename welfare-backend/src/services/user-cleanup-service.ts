import { pool } from '../db.js';
import {
  WelfareRepository,
  type CreateUserCleanupLogInput,
  type UserActivitySummary
} from '../repositories/welfare-repository.js';
import type { SessionUser } from '../types/domain.js';
import { extractLinuxDoSubjectFromEmail } from '../utils/oauth.js';
import { Sub2apiClient, sub2apiClient } from './sub2api-client.js';

type WelfareRepositoryLike = Pick<
  WelfareRepository,
  'listAdminWhitelist' | 'getUserActivitySummaryMap' | 'createUserCleanupLog'
>;

type Sub2apiClientLike = Pick<
  Sub2apiClient,
  'listAllAdminUsers' | 'getAdminUserById' | 'deleteAdminUser'
>;

const repository = new WelfareRepository(pool);

function getEmptyActivitySummary(sub2apiUserId: number): UserActivitySummary {
  return {
    sub2apiUserId,
    checkinCount: 0,
    redeemCount: 0,
    resetCount: 0
  };
}

function hasWelfareActivity(summary: UserActivitySummary): boolean {
  return summary.checkinCount > 0 || summary.redeemCount > 0 || summary.resetCount > 0;
}

function buildCleanupReason(): string {
  return '非 LinuxDo / 非管理员 / 无福利站流水';
}

export class UserCleanupService {
  constructor(
    private readonly cleanupRepository: WelfareRepositoryLike,
    private readonly sub2api: Sub2apiClientLike
  ) {}

  async listCleanupCandidates(params: {
    page: number;
    pageSize: number;
    search?: string;
    currentUserId: number;
  }) {
    const [users, whitelist] = await Promise.all([
      this.sub2api.listAllAdminUsers(params.search?.trim() || ''),
      this.cleanupRepository.listAdminWhitelist()
    ]);
    const adminIds = new Set(
      whitelist
        .map((item) => item.sub2apiUserId)
        .filter(
          (value): value is number =>
            typeof value === 'number' && Number.isInteger(value) && value > 0
        )
    );
    const activityMap = await this.cleanupRepository.getUserActivitySummaryMap(
      users.map((item) => item.id)
    );

    const candidates = users
      .filter((user) => {
        if (user.id === params.currentUserId) {
          return false;
        }

        if (adminIds.has(user.id)) {
          return false;
        }

        if (extractLinuxDoSubjectFromEmail(user.email)) {
          return false;
        }

        const activity = activityMap.get(user.id) ?? getEmptyActivitySummary(user.id);
        return !hasWelfareActivity(activity);
      })
      .map((user) => {
        const activity = activityMap.get(user.id) ?? getEmptyActivitySummary(user.id);
        return {
          sub2api_user_id: user.id,
          email: user.email,
          username: user.username || user.email,
          balance: user.balance ?? null,
          linuxdo_subject: null,
          welfare_activity: {
            checkin_count: activity.checkinCount,
            redeem_count: activity.redeemCount,
            reset_count: activity.resetCount
          },
          cleanup_reason: buildCleanupReason()
        };
      });

    const total = candidates.length;
    const offset = (params.page - 1) * params.pageSize;
    return {
      items: candidates.slice(offset, offset + params.pageSize),
      total
    };
  }

  async deleteCleanupCandidates(
    operator: SessionUser,
    userIds: number[]
  ) {
    const normalizedIds = [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))];
    const whitelist = await this.cleanupRepository.listAdminWhitelist();
    const adminIds = new Set(
      whitelist
        .map((item) => item.sub2apiUserId)
        .filter(
          (value): value is number =>
            typeof value === 'number' && Number.isInteger(value) && value > 0
        )
    );
    const activityMap = await this.cleanupRepository.getUserActivitySummaryMap(normalizedIds);
    const items: Array<{
      sub2api_user_id: number;
      email: string;
      username: string;
      deleted: boolean;
      detail: string;
    }> = [];

    let successCount = 0;
    let failCount = 0;

    for (const userId of normalizedIds) {
      let targetEmail = '';
      let targetUsername = '';
      let targetBalance: number | null = null;

      try {
        const user = await this.sub2api.getAdminUserById(userId);
        if (!user) {
          const detail = '用户不存在';
          await this.logCleanupResult({
            operator,
            targetSub2apiUserId: userId,
            targetEmail,
            targetUsername,
            targetBalance,
            resultStatus: 'failed',
            detail
          });
          items.push({
            sub2api_user_id: userId,
            email: '',
            username: '',
            deleted: false,
            detail
          });
          failCount += 1;
          continue;
        }

        targetEmail = user.email;
        targetUsername = user.username || user.email;
        targetBalance = user.balance ?? null;

        const ineligibleReason = this.getIneligibleReason(
          userId,
          user.email,
          activityMap.get(userId) ?? getEmptyActivitySummary(userId),
          adminIds,
          operator.sub2apiUserId
        );
        if (ineligibleReason) {
          await this.logCleanupResult({
            operator,
            targetSub2apiUserId: userId,
            targetEmail,
            targetUsername,
            targetBalance,
            resultStatus: 'failed',
            detail: ineligibleReason
          });
          items.push({
            sub2api_user_id: userId,
            email: targetEmail,
            username: targetUsername,
            deleted: false,
            detail: ineligibleReason
          });
          failCount += 1;
          continue;
        }

        await this.sub2api.deleteAdminUser(userId);
        const detail = '用户已删除';
        await this.logCleanupResult({
          operator,
          targetSub2apiUserId: userId,
          targetEmail,
          targetUsername,
          targetBalance,
          resultStatus: 'success',
          detail
        });
        items.push({
          sub2api_user_id: userId,
          email: targetEmail,
          username: targetUsername,
          deleted: true,
          detail
        });
        successCount += 1;
      } catch (error) {
        const detail =
          error instanceof Error && error.message.trim() !== ''
            ? error.message
            : '删除失败，请稍后重试';
        await this.logCleanupResult({
          operator,
          targetSub2apiUserId: userId,
          targetEmail,
          targetUsername,
          targetBalance,
          resultStatus: 'failed',
          detail
        });
        items.push({
          sub2api_user_id: userId,
          email: targetEmail,
          username: targetUsername,
          deleted: false,
          detail
        });
        failCount += 1;
      }
    }

    return {
      items,
      total: normalizedIds.length,
      success_count: successCount,
      fail_count: failCount
    };
  }

  private getIneligibleReason(
    userId: number,
    email: string,
    activity: UserActivitySummary,
    adminIds: Set<number>,
    currentUserId: number
  ): string | null {
    if (userId === currentUserId) {
      return '不能删除当前登录管理员';
    }

    if (adminIds.has(userId)) {
      return '福利站管理员不能删除';
    }

    if (extractLinuxDoSubjectFromEmail(email)) {
      return 'LinuxDo 账号不在清理范围';
    }

    if (hasWelfareActivity(activity)) {
      return '用户已有福利站使用记录';
    }

    return null;
  }

  private async logCleanupResult(input: {
    operator: SessionUser;
    targetSub2apiUserId: number;
    targetEmail: string;
    targetUsername: string;
    targetBalance: number | null;
    resultStatus: CreateUserCleanupLogInput['resultStatus'];
    detail: string;
  }) {
    try {
      await this.cleanupRepository.createUserCleanupLog({
        operatorSub2apiUserId: input.operator.sub2apiUserId,
        operatorEmail: input.operator.email,
        operatorUsername: input.operator.username,
        targetSub2apiUserId: input.targetSub2apiUserId,
        targetEmail: input.targetEmail,
        targetUsername: input.targetUsername,
        targetBalance: input.targetBalance,
        resultStatus: input.resultStatus,
        detail: input.detail.slice(0, 500)
      });
    } catch (error) {
      console.error('[user-cleanup] 写入清理审计日志失败', error);
    }
  }
}

export const userCleanupService = new UserCleanupService(repository, sub2apiClient);

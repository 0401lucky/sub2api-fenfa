import { config } from '../config.js';
import { pool } from '../db.js';
import {
  WelfareRepository,
  type CreateBlindboxItemInput,
  type UpdateBlindboxItemInput
} from '../repositories/welfare-repository.js';
import type {
  BlindboxItem,
  CheckinMode,
  CheckinRecord,
  SessionUser
} from '../types/domain.js';
import { getBusinessDate, shiftDateString } from '../utils/date.js';
import { extractLinuxDoSubjectFromEmail } from '../utils/oauth.js';
import { HttpError } from '../utils/http.js';
import { Sub2apiClient, sub2apiClient } from './sub2api-client.js';

export class ConflictError extends Error {}
export class ForbiddenError extends Error {}
export class NotFoundError extends Error {}

const PENDING_RECOVERY_AFTER_MS = Math.max(30_000, config.SUB2API_TIMEOUT_MS * 2);
const BALANCE_HISTORY_PAGE_SIZE = 50;
const BALANCE_HISTORY_MAX_PAGES = 3;
const CHECKIN_HISTORY_MATCH_SKEW_MS = 5 * 60 * 1000;

function buildIdempotencyKey(
  sub2apiUserId: number,
  checkinDate: string,
  checkinMode: CheckinMode
): string {
  return `welfare-checkin:${checkinMode}:${sub2apiUserId}:${checkinDate}`;
}

const repository = new WelfareRepository(pool);

type WelfareRepositoryLike = Pick<
  WelfareRepository,
  | 'getSettings'
  | 'listBlindboxItems'
  | 'createBlindboxItem'
  | 'updateBlindboxItem'
  | 'getCheckinByDate'
  | 'getCheckinById'
  | 'createCheckinPending'
  | 'markCheckinPendingRetry'
  | 'claimStalePending'
  | 'markCheckinSuccess'
  | 'markCheckinFailed'
  | 'updateCheckinRecipient'
  | 'deleteCheckinById'
  | 'listUserCheckins'
  | 'updateSettings'
  | 'getDailyStats'
  | 'getActiveUserCount'
  | 'queryAdminCheckins'
>;

type Sub2apiClientLike = Pick<
  Sub2apiClient,
  | 'addUserBalance'
  | 'findUserByEmail'
  | 'getAdminUserById'
  | 'listAdminUserBalanceHistory'
>;

type CheckinGrantResult =
  | {
      deleted: false;
      newBalance: number | null;
      requestId: string;
      detailMessage: string | null;
    }
  | {
      deleted: true;
      newBalance: null;
      requestId: null;
      deletedReason: string;
      detailMessage: null;
    };

type CheckinRecipientResolution =
  | {
      deleted: false;
      userId: number;
      detailMessage: string | null;
    }
  | {
      deleted: true;
      deletedReason: string;
    };

function buildGrantNotes(record: Pick<CheckinRecord, 'checkinMode' | 'blindboxTitle' | 'checkinDate'>): string {
  if (record.checkinMode === 'blindbox') {
    return `福利盲盒 ${record.blindboxTitle || '惊喜签'} ${record.checkinDate}`;
  }

  return `福利签到 ${record.checkinDate}`;
}

function mergeDetailMessages(...messages: Array<string | null | undefined>): string | null {
  const normalized = messages
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));

  if (normalized.length === 0) {
    return null;
  }

  return normalized.join('；');
}

function isSameBalance(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.000001;
}

function isPendingRecoverable(record: CheckinRecord): boolean {
  if (record.grantStatus !== 'pending') {
    return false;
  }

  const updatedAtMs = Date.parse(record.updatedAt);
  if (Number.isNaN(updatedAtMs)) {
    return true;
  }

  return Date.now() - updatedAtMs >= PENDING_RECOVERY_AFTER_MS;
}

function canAttemptCheckin(
  record: CheckinRecord | null,
  requestedMode: CheckinMode
): boolean {
  if (!record) {
    return true;
  }

  if (record.checkinMode !== requestedMode) {
    return false;
  }

  if (record.grantStatus === 'success') {
    return false;
  }

  if (record.grantStatus === 'failed') {
    return true;
  }

  return isPendingRecoverable(record);
}

function buildBlindboxPreview(items: BlindboxItem[]) {
  const sortedByReward = [...items].sort((left, right) => left.rewardBalance - right.rewardBalance);
  const minReward = sortedByReward[0]?.rewardBalance ?? null;
  const maxReward = sortedByReward[sortedByReward.length - 1]?.rewardBalance ?? null;

  return {
    item_count: items.length,
    min_reward: minReward,
    max_reward: maxReward,
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      reward_balance: item.rewardBalance
    }))
  };
}

function pickRewardBalanceInRange(
  minBalance: number,
  maxBalance: number,
  random: () => number
): number {
  if (maxBalance <= minBalance) {
    return minBalance;
  }

  const rawValue = minBalance + random() * (maxBalance - minBalance);
  return Math.min(
    maxBalance,
    Math.round(rawValue * 100) / 100
  );
}

function buildModeConflictMessage(existingMode: CheckinMode): string {
  if (existingMode === 'normal') {
    return '今日已选择普通签到，不能再开启盲盒';
  }

  return '今日已选择盲盒签到，请继续处理本次盲盒';
}

function buildSuccessConflictMessage(mode: CheckinMode): string {
  return mode === 'blindbox' ? '今日盲盒已开启，请明天再来' : '今日已签到，请明天再来';
}

function buildProcessingMessage(mode: CheckinMode): string {
  return mode === 'blindbox' ? '盲盒处理中，请稍后刷新' : '签到处理中，请稍后刷新';
}

export class CheckinService {
  constructor(
    private readonly repository: WelfareRepositoryLike,
    private readonly sub2api: Sub2apiClientLike,
    private readonly random: () => number = Math.random
  ) {}

  async getStatus(user: SessionUser) {
    const settings = await this.repository.getSettings();
    const checkinDate = getBusinessDate(settings.timezone);
    const [today, blindboxItems] = await Promise.all([
      this.repository.getCheckinByDate(user.sub2apiUserId, checkinDate),
      this.repository.listBlindboxItems(true)
    ]);

    const canCheckinNormal = today?.checkinMode === 'normal'
      ? canAttemptCheckin(today, 'normal')
      : settings.checkinEnabled && canAttemptCheckin(today, 'normal');
    const canCheckinBlindbox = today?.checkinMode === 'blindbox'
      ? canAttemptCheckin(today, 'blindbox')
      : settings.checkinEnabled &&
        settings.blindboxEnabled &&
        blindboxItems.length > 0 &&
        canAttemptCheckin(today, 'blindbox');

    return {
      checkin_enabled: settings.checkinEnabled,
      blindbox_enabled: settings.blindboxEnabled,
      timezone: settings.timezone,
      checkin_date: checkinDate,
      daily_reward_min_balance: settings.dailyRewardMinBalance,
      daily_reward_max_balance: settings.dailyRewardMaxBalance,
      checked_in: today?.grantStatus === 'success',
      selected_mode: today?.checkinMode ?? null,
      grant_status: today?.grantStatus ?? null,
      checked_at: today?.createdAt ?? null,
      reward_balance: today?.rewardBalance ?? null,
      can_checkin_normal: canCheckinNormal,
      can_checkin_blindbox: canCheckinBlindbox,
      blindbox_preview: buildBlindboxPreview(blindboxItems),
      blindbox_result:
        today?.checkinMode === 'blindbox'
          ? {
              item_id: today.blindboxItemId,
              title: today.blindboxTitle || null
            }
          : null
    };
  }

  async getHistory(user: SessionUser, limit = 30) {
    const records = await this.repository.listUserCheckins(user.sub2apiUserId, limit);
    return records.map((item) => ({
      id: item.id,
      checkin_date: item.checkinDate,
      checkin_mode: item.checkinMode,
      blindbox_title: item.checkinMode === 'blindbox' ? item.blindboxTitle || null : null,
      reward_balance: item.rewardBalance,
      grant_status: item.grantStatus,
      grant_error: item.grantError,
      created_at: item.createdAt
    }));
  }

  async checkin(user: SessionUser) {
    return this.performCheckin(user, 'normal');
  }

  async checkBlindbox(user: SessionUser) {
    return this.performCheckin(user, 'blindbox');
  }

  private async performCheckin(user: SessionUser, requestedMode: CheckinMode) {
    const settings = await this.repository.getSettings();
    const checkinDate = getBusinessDate(settings.timezone);
    const existing = await this.repository.getCheckinByDate(user.sub2apiUserId, checkinDate);

    if (existing) {
      const pending = await this.claimRetryableCheckin(
        existing,
        requestedMode,
        buildSuccessConflictMessage(requestedMode)
      );
      const grantResult = await this.grantCheckin(pending);
      return this.toCheckinResponse(pending, grantResult.newBalance);
    }

    if (!settings.checkinEnabled) {
      throw new ForbiddenError('签到功能已关闭');
    }

    let reward = pickRewardBalanceInRange(
      settings.dailyRewardMinBalance,
      settings.dailyRewardMaxBalance,
      this.random
    );
    let blindboxItemId: number | null = null;
    let blindboxTitle = '';

    if (requestedMode === 'blindbox') {
      if (!settings.blindboxEnabled) {
        throw new ForbiddenError('盲盒签到暂未开放');
      }

      const blindboxItems = await this.repository.listBlindboxItems(true);
      const selectedItem = this.pickBlindboxItem(blindboxItems);
      if (!selectedItem) {
        throw new ForbiddenError('当前盲盒奖池不可用，请先选择普通签到');
      }

      reward = selectedItem.rewardBalance;
      blindboxItemId = selectedItem.id;
      blindboxTitle = selectedItem.title;
    }

    let pending = await this.repository.createCheckinPending({
      sub2apiUserId: user.sub2apiUserId,
      sub2apiEmail: user.email,
      sub2apiUsername: user.username,
      linuxdoSubject: user.linuxdoSubject,
      checkinDate,
      checkinMode: requestedMode,
      blindboxItemId,
      blindboxTitle,
      rewardBalance: reward,
      idempotencyKey: buildIdempotencyKey(user.sub2apiUserId, checkinDate, requestedMode)
    });

    if (!pending) {
      const latest = await this.repository.getCheckinByDate(user.sub2apiUserId, checkinDate);
      if (!latest) {
        throw new Error('签到记录读取失败，请稍后重试');
      }

      pending = await this.claimRetryableCheckin(
        latest,
        requestedMode,
        buildSuccessConflictMessage(requestedMode)
      );
    }

    const grantResult = await this.grantCheckin(pending);
    return this.toCheckinResponse(pending, grantResult.newBalance);
  }

  async retryFailedCheckin(id: number) {
    const existing = await this.repository.getCheckinById(id);
    if (!existing) {
      throw new NotFoundError('签到记录不存在');
    }

    const pending = await this.claimRetryableCheckin(
      existing,
      existing.checkinMode,
      existing.checkinMode === 'blindbox' ? '该盲盒签到记录已发放成功' : '该签到记录已发放成功'
    );

    const grantResult = await this.grantCheckin(pending, {
      allowMissingUserDeletion: true,
      allowConflictHistoryRecovery: true
    });
    if (grantResult.deleted) {
      return {
        item: null,
        new_balance: null,
        deleted: true,
        deleted_reason: grantResult.deletedReason,
        detail_message: null
      };
    }

    const updated = await this.repository.getCheckinById(pending.id);
    if (!updated) {
      throw new Error('签到记录读取失败，请稍后重试');
    }

    return {
      item: updated,
      new_balance: grantResult.newBalance,
      deleted: false,
      deleted_reason: null,
      detail_message: grantResult.detailMessage
    };
  }

  private async grantCheckin(
    record: CheckinRecord,
    options: {
      allowMissingUserDeletion?: boolean;
      allowConflictHistoryRecovery?: boolean;
    } = {}
  ): Promise<CheckinGrantResult> {
    const recipient = await this.resolveRecipientUserId(
      record,
      options.allowMissingUserDeletion ?? false
    );
    if (recipient.deleted) {
      const deleted = await this.repository.deleteCheckinById(record.id);
      if (!deleted) {
        throw new ConflictError('签到记录状态已变更，请刷新后重试');
      }

      return {
        deleted: true,
        newBalance: null,
        requestId: null,
        deletedReason: recipient.deletedReason,
        detailMessage: null
      };
    }

    let grantResult: Awaited<ReturnType<Sub2apiClientLike['addUserBalance']>>;

    try {
      grantResult = await this.sub2api.addUserBalance({
        userId: recipient.userId,
        amount: record.rewardBalance,
        notes: buildGrantNotes(record),
        idempotencyKey: record.idempotencyKey
      });
    } catch (error) {
      const recovered = await this.recoverCheckinConflictFromHistory(
        record,
        recipient,
        error,
        options.allowConflictHistoryRecovery ?? false
      );
      if (recovered) {
        return recovered;
      }

      const message = error instanceof Error ? error.message : 'unknown error';
      try {
        await this.repository.markCheckinFailed(record.id, message.slice(0, 500));
      } catch (markFailedError) {
        console.error('[checkin] 回写失败状态异常', markFailedError);
      }
      throw error;
    }

    await this.repository.markCheckinSuccess(record.id, grantResult.requestId);
    return {
      deleted: false,
      newBalance: grantResult.newBalance ?? null,
      requestId: grantResult.requestId,
      detailMessage: recipient.detailMessage
    };
  }

  private async recoverCheckinConflictFromHistory(
    record: CheckinRecord,
    recipient: Extract<CheckinRecipientResolution, { deleted: false }>,
    error: unknown,
    allowConflictHistoryRecovery: boolean
  ): Promise<CheckinGrantResult | null> {
    if (!allowConflictHistoryRecovery) {
      return null;
    }

    if (!(error instanceof HttpError) || error.status !== 409) {
      return null;
    }

    try {
      const matched = await this.findRecoveredCheckinHistoryItem(record, recipient.userId);
      if (!matched) {
        return null;
      }

      const recoveredRequestId = `recovered-history:${matched.id}`;
      await this.repository.markCheckinSuccess(record.id, recoveredRequestId);
      return {
        deleted: false,
        newBalance: null,
        requestId: recoveredRequestId,
        detailMessage: mergeDetailMessages(
          recipient.detailMessage,
          '主站已确认这笔签到奖励到账，已自动修正本地状态'
        )
      };
    } catch (historyError) {
      console.warn('[checkin] 409 后查询主站余额流水失败', historyError);
      return null;
    }
  }

  private async findRecoveredCheckinHistoryItem(
    record: CheckinRecord,
    userId: number
  ) {
    const expectedNotes = buildGrantNotes(record);
    const recordCreatedAtMs = Date.parse(record.createdAt);
    const lowerBoundMs = Number.isNaN(recordCreatedAtMs)
      ? Number.NEGATIVE_INFINITY
      : recordCreatedAtMs - CHECKIN_HISTORY_MATCH_SKEW_MS;

    for (let page = 1; page <= BALANCE_HISTORY_MAX_PAGES; page += 1) {
      const response = await this.sub2api.listAdminUserBalanceHistory({
        userId,
        page,
        pageSize: BALANCE_HISTORY_PAGE_SIZE,
        type: 'admin_balance'
      });

      for (const item of response.items) {
        const createdAtMs = Date.parse(item.createdAt);
        if (
          item.type === 'admin_balance' &&
          item.notes.trim() === expectedNotes &&
          isSameBalance(item.value, record.rewardBalance) &&
          (Number.isNaN(createdAtMs) || createdAtMs >= lowerBoundMs)
        ) {
          return item;
        }
      }

      const oldestCreatedAtMs = response.items.reduce<number | null>((oldest, item) => {
        const current = Date.parse(item.createdAt);
        if (Number.isNaN(current)) {
          return oldest;
        }
        if (oldest == null) {
          return current;
        }
        return Math.min(oldest, current);
      }, null);

      if (
        page >= response.pages ||
        response.items.length === 0 ||
        (oldestCreatedAtMs != null && oldestCreatedAtMs < lowerBoundMs)
      ) {
        break;
      }
    }

    return null;
  }

  private async resolveRecipientUserId(
    record: CheckinRecord,
    allowMissingUserDeletion: boolean
  ): Promise<CheckinRecipientResolution> {
    try {
      const user = await this.sub2api.getAdminUserById(record.sub2apiUserId);
      if (user?.id) {
        return {
          deleted: false,
          userId: user.id,
          detailMessage: null
        };
      }
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 404)) {
        throw error;
      }
    }

    const fallbackUser = await this.sub2api.findUserByEmail(record.sub2apiEmail);
    if (!fallbackUser?.id) {
      if (allowMissingUserDeletion) {
        return {
          deleted: true,
          deletedReason: '主站已无该邮箱用户，已自动移除这条补发记录'
        };
      }

      throw new HttpError(404, '', '主站用户不存在，可能已被删除或重建');
    }

    let detailMessage: string | null = null;
    if (fallbackUser.id !== record.sub2apiUserId) {
      await this.repository.updateCheckinRecipient(record.id, {
        sub2apiUserId: fallbackUser.id,
        sub2apiEmail: fallbackUser.email,
        sub2apiUsername: fallbackUser.username || fallbackUser.email,
        linuxdoSubject: extractLinuxDoSubjectFromEmail(fallbackUser.email)
      });
      detailMessage = '旧主站用户 ID 已失效，已自动切换到当前主站账号后补发';
    }

    return {
      deleted: false,
      userId: fallbackUser.id,
      detailMessage
    };
  }

  async getAdminSettings() {
    return this.repository.getSettings();
  }

  async updateAdminSettings(input: {
    checkinEnabled?: boolean;
    blindboxEnabled?: boolean;
    dailyRewardMinBalance?: number;
    dailyRewardMaxBalance?: number;
    timezone?: string;
    resetEnabled?: boolean;
    resetThresholdBalance?: number;
    resetTargetBalance?: number;
    resetCooldownDays?: number;
    resetNotice?: string;
  }) {
    return this.repository.updateSettings(input);
  }

  async listAdminBlindboxItems() {
    return this.repository.listBlindboxItems(false);
  }

  async createAdminBlindboxItem(input: CreateBlindboxItemInput) {
    return this.repository.createBlindboxItem(input);
  }

  async updateAdminBlindboxItem(id: number, input: UpdateBlindboxItemInput) {
    const updated = await this.repository.updateBlindboxItem(id, input);
    if (!updated) {
      throw new NotFoundError('盲盒奖项不存在');
    }
    return updated;
  }

  async getAdminDailyStats(days: number) {
    const settings = await this.repository.getSettings();
    const today = getBusinessDate(settings.timezone);
    const startDate = shiftDateString(today, -(days - 1));
    const [points, activeUsers] = await Promise.all([
      this.repository.getDailyStats(startDate),
      this.repository.getActiveUserCount(startDate)
    ]);
    const totalUsers = points.reduce((sum, point) => sum + point.checkinUsers, 0);
    const totalGrant = points.reduce((sum, point) => sum + point.grantTotal, 0);
    return {
      days,
      active_users: activeUsers,
      total_checkins: totalUsers,
      total_grant_balance: totalGrant,
      points
    };
  }

  async getAdminCheckins(params: {
    page: number;
    pageSize: number;
    dateFrom?: string;
    dateTo?: string;
    grantStatus?: string;
    subject?: string;
  }) {
    return this.repository.queryAdminCheckins(params);
  }

  private pickBlindboxItem(items: BlindboxItem[]): BlindboxItem | null {
    const normalized = items.filter((item) => item.enabled && item.weight > 0);
    if (normalized.length === 0) {
      return null;
    }

    const totalWeight = normalized.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) {
      return null;
    }

    let cursor = this.random() * totalWeight;
    for (const item of normalized) {
      cursor -= item.weight;
      if (cursor < 0) {
        return item;
      }
    }

    return normalized[normalized.length - 1] ?? null;
  }

  private async claimRetryableCheckin(
    existing: CheckinRecord,
    requestedMode: CheckinMode,
    successConflictMessage: string
  ): Promise<CheckinRecord> {
    if (existing.checkinMode !== requestedMode) {
      throw new ConflictError(buildModeConflictMessage(existing.checkinMode));
    }

    if (existing.grantStatus === 'success') {
      throw new ConflictError(successConflictMessage);
    }

    if (existing.grantStatus === 'failed') {
      const pending = await this.repository.markCheckinPendingRetry(existing.id);
      if (!pending) {
        throw new ConflictError(buildProcessingMessage(requestedMode));
      }
      return pending;
    }

    if (!isPendingRecoverable(existing)) {
      throw new ConflictError(buildProcessingMessage(requestedMode));
    }

    const pending = await this.repository.claimStalePending(
      existing.id,
      PENDING_RECOVERY_AFTER_MS
    );
    if (!pending) {
      throw new ConflictError(buildProcessingMessage(requestedMode));
    }

    return pending;
  }

  private toCheckinResponse(record: CheckinRecord, newBalance: number | null) {
    return {
      checkin_date: record.checkinDate,
      checkin_mode: record.checkinMode,
      blindbox_item_id: record.blindboxItemId,
      blindbox_title: record.checkinMode === 'blindbox' ? record.blindboxTitle || null : null,
      reward_balance: record.rewardBalance,
      new_balance: newBalance,
      grant_status: 'success' as const
    };
  }
}

export const checkinService = new CheckinService(repository, sub2apiClient);
export const welfareRepository = repository;

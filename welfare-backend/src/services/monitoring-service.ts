import { config } from '../config.js';
import { pool } from '../db.js';
import { MonitoringRepository } from '../repositories/monitoring-repository.js';
import { RiskRepository } from '../repositories/risk-repository.js';
import { WelfareRepository } from '../repositories/welfare-repository.js';
import type {
  MonitoringAction,
  MonitoringActionType,
  MonitoringSnapshot,
  RiskBand,
  RiskEvent,
  RiskEventStatus,
  RiskRuleHit,
  RiskScanState
} from '../types/domain.js';
import { extractLinuxDoSubjectFromEmail } from '../utils/oauth.js';
import { sessionStateService, SessionStateService } from './session-state-service.js';
import { distributionDetectionService } from './distribution-detection-service.js';
import {
  cloudflareClient,
  CloudflareClientConflictError,
  CloudflareClientConfigError,
  CloudflareClientRequestError,
  type CloudflareClientLike,
  type CloudflareIpAccessMode,
  type CloudflareIpAccessRule
} from './cloudflare-client.js';
import {
  sub2apiClient,
  type AdminUserRecord,
  type Sub2apiClient
} from './sub2api-client.js';
import { buildIpRuleHits, buildUserRuleHits, riskBandFromScore, scoreRiskHits } from './monitoring-rules.js';
import {
  usageAnalysisService,
  type EffectiveUsageEntry,
  type UsageAnalysisService,
  type UsageAnalysisSnapshot,
  type UsageExcludedBreakdown
} from './usage-analysis-service.js';

const MONITORING_WINDOW_10M_MS = 10 * 60 * 1000;
const MONITORING_WINDOW_1H_MS = 60 * 60 * 1000;
const MONITORING_WINDOW_3H_MS = 3 * 60 * 60 * 1000;
const MONITORING_WINDOW_6H_MS = 6 * 60 * 60 * 1000;
const MONITORING_WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const MONITORING_MAX_SAMPLE_USERS = 4;
const CLOUDFLARE_MANAGED_RULE_PREFIX = 'welfare-monitoring|';

interface LoggerLike {
  info(message: string): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
}

type MonitoringUsageEntry = EffectiveUsageEntry;

interface MonitoringProtectedState {
  protectedUserIds: Set<number>;
  protectedSubjects: Set<string>;
}

export interface MonitoringSnapshotPoint {
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

export interface MonitoringActionItem extends MonitoringAction {}

export interface MonitoringOverview {
  generatedAt: string;
  thresholds: {
    observeIpCount: number;
    blockIpCount: number;
    lockDurationMs: number;
    liveCacheTtlMs: number;
    snapshotIntervalMs: number;
  };
  summary: {
    rawRequestCount24h: number;
    requestCount24h: number;
    excludedCount24h: number;
    activeUserCount24h: number;
    uniqueIpCount24h: number;
    observeUserCount1h: number;
    blockedUserCount: number;
    pendingReleaseCount: number;
    sharedIpCount1h: number;
    sharedIpCount24h: number;
  };
  excludedBreakdown: UsageExcludedBreakdown;
  windows: {
    observeUserCount1h: number;
    observeUserCount24h: number;
    sharedUserCount24h: number;
    sharedIpCount1h: number;
    sharedIpCount24h: number;
  };
  usageSyncState: UsageAnalysisSnapshot['usageSyncState'];
  lastScan: RiskScanState;
  snapshotPoints: MonitoringSnapshotPoint[];
  recentActions: MonitoringActionItem[];
}

export interface MonitoringIpUserItem {
  sub2apiUserId: number;
  sub2apiEmail: string;
  sub2apiUsername: string;
  linuxdoSubject: string | null;
  sub2apiRole: 'admin' | 'user';
  sub2apiStatus: string;
  isAdminProtected: boolean;
  riskStatus: RiskEventStatus | null;
  riskEventId: number | null;
  requestCount1h: number;
  requestCount24h: number;
  uniqueIpCount1h: number;
  uniqueIpCount24h: number;
  riskScore: number;
  riskBand: RiskBand;
  ruleHits: RiskRuleHit[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface MonitoringIpItem {
  ipAddress: string;
  requestCount10m: number;
  requestCount1h: number;
  requestCount24h: number;
  userCount10m: number;
  userCount1h: number;
  userCount24h: number;
  firstSeenAt: string;
  lastSeenAt: string;
  riskLevel: 'normal' | 'observe' | 'block';
  riskScore: number;
  riskBand: RiskBand;
  ruleHits: RiskRuleHit[];
  sampleUsers: Array<{
    sub2apiUserId: number;
    sub2apiUsername: string;
    sub2apiEmail: string;
  }>;
}

export interface MonitoringUserIpItem {
  ipAddress: string;
  requestCount1h: number;
  requestCount24h: number;
  sharedUserCount24h: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface MonitoringUserItem {
  sub2apiUserId: number;
  sub2apiEmail: string;
  sub2apiUsername: string;
  linuxdoSubject: string | null;
  sub2apiRole: 'admin' | 'user';
  sub2apiStatus: string;
  isAdminProtected: boolean;
  riskStatus: RiskEventStatus | null;
  riskEventId: number | null;
  requestCount1h: number;
  requestCount24h: number;
  uniqueIpCount1h: number;
  uniqueIpCount24h: number;
  riskScore: number;
  riskBand: RiskBand;
  ruleHits: RiskRuleHit[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface MonitoringIpCloudflareRule {
  id: string;
  mode: CloudflareIpAccessMode;
  source: 'managed' | 'external';
  notes: string;
  createdAt: string | null;
  modifiedAt: string | null;
}

export interface MonitoringIpCloudflareStatus {
  ipAddress: string;
  enabled: boolean;
  canManage: boolean;
  disabledReason: string;
  matchedRuleCount: number;
  rule: MonitoringIpCloudflareRule | null;
}

interface MonitoringIpDetail extends MonitoringIpItem {
  users: MonitoringIpUserItem[];
}

interface MonitoringUserDetail extends MonitoringUserItem {
  ips: MonitoringUserIpItem[];
}

export interface MonitoringIpDetailView {
  ip: MonitoringIpItem;
  users: MonitoringIpUserItem[];
  cloudflare: MonitoringIpCloudflareStatus;
  recentActions: MonitoringActionItem[];
  generatedAt: string;
}

export interface MonitoringUserDetailView {
  user: MonitoringUserItem;
  ips: MonitoringUserIpItem[];
  openRiskEvent: RiskEvent | null;
  recentActions: MonitoringActionItem[];
  generatedAt: string;
}

interface MonitoringAggregateSummary {
  rawRequestCount24h: number;
  requestCount24h: number;
  excludedCount24h: number;
  activeUserCount24h: number;
  uniqueIpCount24h: number;
  observeUserCount1h: number;
  observeUserCount24h: number;
  blockedUserCount: number;
  pendingReleaseCount: number;
  sharedIpCount1h: number;
  sharedIpCount24h: number;
  sharedUserCount24h: number;
}

interface MonitoringAggregateIndex {
  generatedAt: string;
  summary: MonitoringAggregateSummary;
  excludedBreakdown: UsageExcludedBreakdown;
  usageSyncState: UsageAnalysisSnapshot['usageSyncState'];
  ips: MonitoringIpDetail[];
  users: MonitoringUserDetail[];
}

interface MonitoringAggregateCacheValue {
  index: MonitoringAggregateIndex;
  expiresAtMs: number;
}

interface CloudflareRuleSnapshot extends CloudflareIpAccessRule {
  source: 'managed' | 'external';
}

function normalizeIp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '' ? null : normalized;
}

function normalizeUserRole(value: string | undefined): 'admin' | 'user' {
  return value === 'admin' ? 'admin' : 'user';
}

function normalizeUserStatus(value: string | undefined): string {
  const normalized = (value ?? '').trim();
  return normalized === '' ? 'active' : normalized;
}

function getRiskSortWeight(status: RiskEventStatus | null): number {
  if (status === 'active') {
    return 2;
  }
  if (status === 'pending_release') {
    return 1;
  }
  return 0;
}

function compareIsoDesc(left: string, right: string): number {
  return Date.parse(right) - Date.parse(left);
}

function buildSnapshotPoint(item: MonitoringSnapshot): MonitoringSnapshotPoint {
  return {
    snapshotAt: item.snapshotAt,
    rawRequestCount24h: item.rawRequestCount24h,
    requestCount24h: item.requestCount24h,
    activeUserCount24h: item.activeUserCount24h,
    uniqueIpCount24h: item.uniqueIpCount24h,
    observeUserCount1h: item.observeUserCount1h,
    blockedUserCount: item.blockedUserCount,
    pendingReleaseCount: item.pendingReleaseCount,
    sharedIpCount1h: item.sharedIpCount1h,
    sharedIpCount24h: item.sharedIpCount24h
  };
}

function isManagedCloudflareRule(rule: CloudflareIpAccessRule): boolean {
  return rule.notes.startsWith(CLOUDFLARE_MANAGED_RULE_PREFIX);
}

function describeCloudflareMode(mode: CloudflareIpAccessMode): string {
  switch (mode) {
    case 'managed_challenge':
      return '托管质询';
    case 'block':
      return '直接封禁';
    case 'challenge':
      return '传统质询';
    case 'js_challenge':
      return 'JavaScript 质询';
    case 'whitelist':
      return '放行';
    default:
      return mode;
  }
}

type WelfareRepositoryLike = Pick<WelfareRepository, 'listAdminWhitelist'>;

type Sub2apiClientLike = Pick<
  Sub2apiClient,
  'getAdminUserById' | 'updateAdminUserStatus'
>;

type DistributionDetectionServiceLike = Pick<typeof distributionDetectionService, 'getOverview'>;
type UsageAnalysisServiceLike = Pick<UsageAnalysisService, 'getSnapshot'>;

export class MonitoringNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MonitoringNotFoundError';
  }
}

export class MonitoringConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MonitoringConflictError';
  }
}

export class MonitoringFeatureUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MonitoringFeatureUnavailableError';
  }
}

export class MonitoringUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MonitoringUpstreamError';
  }
}

export function buildMonitoringAggregateIndex(_input: {
  entries: MonitoringUsageEntry[];
  rawUsageCount24h?: number;
  excludedCount24h?: number;
  excludedBreakdown?: UsageExcludedBreakdown;
  usageSyncState?: UsageAnalysisSnapshot['usageSyncState'];
  nowMs?: number;
  observeIpThreshold: number;
  blockIpThreshold: number;
  openRiskEvents: Array<{
    id: number;
    sub2apiUserId: number;
    status: Extract<RiskEventStatus, 'active' | 'pending_release'>;
  }>;
  protectedUsers: MonitoringProtectedState;
}): MonitoringAggregateIndex {
  const input = _input;
  const nowMs = input.nowMs ?? Date.now();
  const tenMinuteCutoff = nowMs - MONITORING_WINDOW_10M_MS;
  const oneHourCutoff = nowMs - MONITORING_WINDOW_1H_MS;
  const threeHourCutoff = nowMs - MONITORING_WINDOW_3H_MS;
  const sixHourCutoff = nowMs - MONITORING_WINDOW_6H_MS;
  const riskEventByUserId = new Map(
    input.openRiskEvents.map((item) => [item.sub2apiUserId, item] as const)
  );
  const userMap = new Map<
    number,
    {
      detail: MonitoringUserDetail;
      ipStats: Map<
        string,
        {
          requestCount1h: number;
          requestCount24h: number;
          firstSeenAt: string;
          lastSeenAt: string;
        }
      >;
      uniqueIpSet1h: Set<string>;
      uniqueIpSet3h: Set<string>;
      uniqueIpSet6h: Set<string>;
      uniqueIpSet24h: Set<string>;
    }
  >();
  const ipMap = new Map<
    string,
    {
      detail: MonitoringIpDetail;
      userStats: Map<
        number,
        {
          requestCount1h: number;
          requestCount24h: number;
          firstSeenAt: string;
          lastSeenAt: string;
        }
      >;
      userSet10m: Set<number>;
      userSet1h: Set<number>;
      userSet24h: Set<number>;
    }
  >();

  for (const entry of input.entries) {
    const riskEvent = riskEventByUserId.get(entry.userId);
    const isProtected =
      entry.role === 'admin' ||
      input.protectedUsers.protectedUserIds.has(entry.userId) ||
      (entry.linuxdoSubject != null &&
        input.protectedUsers.protectedSubjects.has(entry.linuxdoSubject));

    const userState =
      userMap.get(entry.userId) ??
      {
        detail: {
          sub2apiUserId: entry.userId,
          sub2apiEmail: entry.email,
          sub2apiUsername: entry.username,
          linuxdoSubject: entry.linuxdoSubject,
          sub2apiRole: entry.role,
          sub2apiStatus: entry.status,
          isAdminProtected: isProtected,
          riskStatus: riskEvent?.status ?? null,
          riskEventId: riskEvent?.id ?? null,
          requestCount1h: 0,
          requestCount24h: 0,
          uniqueIpCount1h: 0,
          uniqueIpCount24h: 0,
          riskScore: 0,
          riskBand: 'normal',
          ruleHits: [],
          firstSeenAt: entry.createdAt,
          lastSeenAt: entry.createdAt,
          ips: []
        },
        ipStats: new Map(),
        uniqueIpSet1h: new Set(),
        uniqueIpSet3h: new Set(),
        uniqueIpSet6h: new Set(),
        uniqueIpSet24h: new Set()
      };

    userState.detail.requestCount24h += 1;
    if (entry.createdAtMs >= oneHourCutoff) {
      userState.detail.requestCount1h += 1;
      userState.uniqueIpSet1h.add(entry.ipAddress);
    }
    if (entry.createdAtMs >= threeHourCutoff) {
      userState.uniqueIpSet3h.add(entry.ipAddress);
    }
    if (entry.createdAtMs >= sixHourCutoff) {
      userState.uniqueIpSet6h.add(entry.ipAddress);
    }
    userState.uniqueIpSet24h.add(entry.ipAddress);
    if (Date.parse(entry.createdAt) < Date.parse(userState.detail.firstSeenAt)) {
      userState.detail.firstSeenAt = entry.createdAt;
    }
    if (Date.parse(entry.createdAt) > Date.parse(userState.detail.lastSeenAt)) {
      userState.detail.lastSeenAt = entry.createdAt;
    }

    const userIpStat =
      userState.ipStats.get(entry.ipAddress) ?? {
        requestCount1h: 0,
        requestCount24h: 0,
        firstSeenAt: entry.createdAt,
        lastSeenAt: entry.createdAt
      };
    userIpStat.requestCount24h += 1;
    if (entry.createdAtMs >= oneHourCutoff) {
      userIpStat.requestCount1h += 1;
    }
    if (Date.parse(entry.createdAt) < Date.parse(userIpStat.firstSeenAt)) {
      userIpStat.firstSeenAt = entry.createdAt;
    }
    if (Date.parse(entry.createdAt) > Date.parse(userIpStat.lastSeenAt)) {
      userIpStat.lastSeenAt = entry.createdAt;
    }
    userState.ipStats.set(entry.ipAddress, userIpStat);
    userMap.set(entry.userId, userState);

    const ipState =
      ipMap.get(entry.ipAddress) ??
      {
        detail: {
          ipAddress: entry.ipAddress,
          requestCount10m: 0,
          requestCount1h: 0,
          requestCount24h: 0,
          userCount10m: 0,
          userCount1h: 0,
          userCount24h: 0,
          firstSeenAt: entry.createdAt,
          lastSeenAt: entry.createdAt,
          riskLevel: 'normal',
          riskScore: 0,
          riskBand: 'normal',
          ruleHits: [],
          sampleUsers: [],
          users: []
        },
        userStats: new Map(),
        userSet10m: new Set(),
        userSet1h: new Set(),
        userSet24h: new Set()
      };

    ipState.detail.requestCount24h += 1;
    ipState.userSet24h.add(entry.userId);
    if (entry.createdAtMs >= tenMinuteCutoff) {
      ipState.detail.requestCount10m += 1;
      ipState.userSet10m.add(entry.userId);
    }
    if (entry.createdAtMs >= oneHourCutoff) {
      ipState.detail.requestCount1h += 1;
      ipState.userSet1h.add(entry.userId);
    }
    if (Date.parse(entry.createdAt) < Date.parse(ipState.detail.firstSeenAt)) {
      ipState.detail.firstSeenAt = entry.createdAt;
    }
    if (Date.parse(entry.createdAt) > Date.parse(ipState.detail.lastSeenAt)) {
      ipState.detail.lastSeenAt = entry.createdAt;
    }

    const ipUserStat =
      ipState.userStats.get(entry.userId) ?? {
        requestCount1h: 0,
        requestCount24h: 0,
        firstSeenAt: entry.createdAt,
        lastSeenAt: entry.createdAt
      };
    ipUserStat.requestCount24h += 1;
    if (entry.createdAtMs >= oneHourCutoff) {
      ipUserStat.requestCount1h += 1;
    }
    if (Date.parse(entry.createdAt) < Date.parse(ipUserStat.firstSeenAt)) {
      ipUserStat.firstSeenAt = entry.createdAt;
    }
    if (Date.parse(entry.createdAt) > Date.parse(ipUserStat.lastSeenAt)) {
      ipUserStat.lastSeenAt = entry.createdAt;
    }
    ipState.userStats.set(entry.userId, ipUserStat);
    ipMap.set(entry.ipAddress, ipState);
  }

  for (const [, userState] of userMap) {
    userState.detail.uniqueIpCount1h = userState.uniqueIpSet1h.size;
    const uniqueIpCount3h = userState.uniqueIpSet3h.size;
    const uniqueIpCount6h = userState.uniqueIpSet6h.size;
    userState.detail.uniqueIpCount24h = userState.uniqueIpSet24h.size;
    userState.detail.ruleHits = buildUserRuleHits({
      uniqueIpCount1h: userState.detail.uniqueIpCount1h,
      uniqueIpCount3h,
      uniqueIpCount6h,
      uniqueIpCount24h: userState.detail.uniqueIpCount24h,
      observeThreshold: input.observeIpThreshold,
      blockThreshold: input.blockIpThreshold
    });
    userState.detail.riskScore = scoreRiskHits(userState.detail.ruleHits);
    userState.detail.riskBand = riskBandFromScore(userState.detail.riskScore);
  }

  for (const [, ipState] of ipMap) {
    ipState.detail.userCount10m = ipState.userSet10m.size;
    ipState.detail.userCount1h = ipState.userSet1h.size;
    ipState.detail.userCount24h = ipState.userSet24h.size;
    ipState.detail.ruleHits = buildIpRuleHits({
      userCount10m: ipState.detail.userCount10m,
      userCount1h: ipState.detail.userCount1h,
      userCount24h: ipState.detail.userCount24h,
      linkedRiskUserCount: Array.from(ipState.userSet24h).filter((userId) =>
        riskEventByUserId.has(userId)
      ).length,
      observeThreshold: input.observeIpThreshold,
      blockThreshold: input.blockIpThreshold
    });
    ipState.detail.riskScore = scoreRiskHits(ipState.detail.ruleHits);
    ipState.detail.riskBand = riskBandFromScore(ipState.detail.riskScore);
    ipState.detail.riskLevel = ipState.detail.riskBand;
  }

  const users = Array.from(userMap.values()).map((userState) => {
    userState.detail.ips = Array.from(userState.ipStats.entries())
      .map(([ipAddress, stat]) => ({
        ipAddress,
        requestCount1h: stat.requestCount1h,
        requestCount24h: stat.requestCount24h,
        sharedUserCount24h: ipMap.get(ipAddress)?.detail.userCount24h ?? 0,
        firstSeenAt: stat.firstSeenAt,
        lastSeenAt: stat.lastSeenAt
      }))
      .sort((left, right) => {
        if (right.requestCount24h !== left.requestCount24h) {
          return right.requestCount24h - left.requestCount24h;
        }
        if (right.sharedUserCount24h !== left.sharedUserCount24h) {
          return right.sharedUserCount24h - left.sharedUserCount24h;
        }
        return compareIsoDesc(left.lastSeenAt, right.lastSeenAt);
      });
    return userState.detail;
  });

  const userDetailById = new Map(users.map((item) => [item.sub2apiUserId, item] as const));
  const ips = Array.from(ipMap.values()).map((ipState) => {
    ipState.detail.users = Array.from(ipState.userStats.entries())
      .map(([userId, stat]) => {
        const userDetail = userDetailById.get(userId);
        return {
          sub2apiUserId: userId,
          sub2apiEmail: userDetail?.sub2apiEmail ?? '',
          sub2apiUsername: userDetail?.sub2apiUsername ?? String(userId),
          linuxdoSubject: userDetail?.linuxdoSubject ?? null,
          sub2apiRole: userDetail?.sub2apiRole ?? 'user',
          sub2apiStatus: userDetail?.sub2apiStatus ?? 'active',
          isAdminProtected: userDetail?.isAdminProtected ?? false,
          riskStatus: userDetail?.riskStatus ?? null,
          riskEventId: userDetail?.riskEventId ?? null,
          requestCount1h: stat.requestCount1h,
          requestCount24h: stat.requestCount24h,
          uniqueIpCount1h: userDetail?.uniqueIpCount1h ?? 0,
          uniqueIpCount24h: userDetail?.uniqueIpCount24h ?? 0,
          riskScore: userDetail?.riskScore ?? 0,
          riskBand: userDetail?.riskBand ?? 'normal',
          ruleHits: userDetail?.ruleHits ?? [],
          firstSeenAt: stat.firstSeenAt,
          lastSeenAt: stat.lastSeenAt
        };
      })
      .sort((left, right) => {
        const riskWeightDelta =
          getRiskSortWeight(right.riskStatus) - getRiskSortWeight(left.riskStatus);
        if (riskWeightDelta !== 0) {
          return riskWeightDelta;
        }
        if (right.requestCount24h !== left.requestCount24h) {
          return right.requestCount24h - left.requestCount24h;
        }
        return compareIsoDesc(left.lastSeenAt, right.lastSeenAt);
      });
    ipState.detail.sampleUsers = ipState.detail.users
      .slice(0, MONITORING_MAX_SAMPLE_USERS)
      .map((item) => ({
        sub2apiUserId: item.sub2apiUserId,
        sub2apiUsername: item.sub2apiUsername,
        sub2apiEmail: item.sub2apiEmail
      }));
    return ipState.detail;
  });

  const sortedIps = ips.sort((left, right) => {
    const riskLevelWeight: Record<RiskBand, number> = {
      block: 2,
      observe: 1,
      normal: 0
    };
    if (riskLevelWeight[right.riskBand] !== riskLevelWeight[left.riskBand]) {
      return riskLevelWeight[right.riskBand] - riskLevelWeight[left.riskBand];
    }
    if (right.riskScore !== left.riskScore) {
      return right.riskScore - left.riskScore;
    }
    if (right.userCount1h !== left.userCount1h) {
      return right.userCount1h - left.userCount1h;
    }
    if (right.userCount24h !== left.userCount24h) {
      return right.userCount24h - left.userCount24h;
    }
    if (right.requestCount24h !== left.requestCount24h) {
      return right.requestCount24h - left.requestCount24h;
    }
    return compareIsoDesc(left.lastSeenAt, right.lastSeenAt);
  });

  const sortedUsers = users.sort((left, right) => {
    const riskWeightDelta =
      getRiskSortWeight(right.riskStatus) - getRiskSortWeight(left.riskStatus);
    if (riskWeightDelta !== 0) {
      return riskWeightDelta;
    }
    if (right.riskScore !== left.riskScore) {
      return right.riskScore - left.riskScore;
    }
    if (right.uniqueIpCount1h !== left.uniqueIpCount1h) {
      return right.uniqueIpCount1h - left.uniqueIpCount1h;
    }
    if (right.uniqueIpCount24h !== left.uniqueIpCount24h) {
      return right.uniqueIpCount24h - left.uniqueIpCount24h;
    }
    if (right.requestCount24h !== left.requestCount24h) {
      return right.requestCount24h - left.requestCount24h;
    }
    return compareIsoDesc(left.lastSeenAt, right.lastSeenAt);
  });

  return {
    generatedAt: new Date(nowMs).toISOString(),
    summary: {
      rawRequestCount24h: input.rawUsageCount24h ?? input.entries.length,
      requestCount24h: input.entries.length,
      excludedCount24h: input.excludedCount24h ?? 0,
      activeUserCount24h: sortedUsers.length,
      uniqueIpCount24h: sortedIps.length,
      observeUserCount1h: sortedUsers.filter(
        (item) =>
          item.uniqueIpCount1h >= input.observeIpThreshold &&
          item.uniqueIpCount1h < input.blockIpThreshold
      ).length,
      observeUserCount24h: sortedUsers.filter(
        (item) => item.uniqueIpCount24h >= input.observeIpThreshold
      ).length,
      blockedUserCount: sortedUsers.filter((item) => item.riskStatus === 'active').length,
      pendingReleaseCount: sortedUsers.filter(
        (item) => item.riskStatus === 'pending_release'
      ).length,
      sharedIpCount1h: sortedIps.filter((item) => item.userCount1h >= 2).length,
      sharedIpCount24h: sortedIps.filter((item) => item.userCount24h >= 2).length,
      sharedUserCount24h: sortedUsers.filter((item) => item.uniqueIpCount24h >= 2).length
    },
    excludedBreakdown:
      input.excludedBreakdown ??
      {
        invalidCreatedAt: 0,
        missingUserId: 0,
        missingIpAddress: 0,
        outsideWindow: 0
      },
    usageSyncState:
      input.usageSyncState ??
      {
        lastStartedAt: null,
        lastFinishedAt: null,
        lastStatus: 'idle',
        lastError: '',
        fetchedPageCount: 0,
        upsertedCount: 0,
        updatedAt: new Date(nowMs).toISOString()
      },
    ips: sortedIps,
    users: sortedUsers
  };
}

export class MonitoringService {
  private aggregateCache: MonitoringAggregateCacheValue | null = null;
  private aggregateCachePromise: Promise<MonitoringAggregateIndex> | null = null;

  constructor(
    private readonly repository: MonitoringRepository,
    private readonly riskRepository: RiskRepository,
    private readonly sessionState: Pick<SessionStateService, 'bumpSessionVersion'>,
    private readonly sub2api: Sub2apiClientLike,
    private readonly welfare: WelfareRepositoryLike,
    private readonly distribution: DistributionDetectionServiceLike,
    private readonly cloudflare: CloudflareClientLike,
    private readonly logger: LoggerLike,
    private readonly usageAnalysis: UsageAnalysisServiceLike = usageAnalysisService
  ) {}

  startSnapshotLoop(intervalMs = config.WELFARE_MONITOR_SNAPSHOT_INTERVAL_MS): NodeJS.Timeout {
    const run = async () => {
      try {
        await this.captureSnapshot();
      } catch (error) {
        this.logger.error('[monitoring] 定时快照失败', error);
      }
    };

    void run();
    const timer = setInterval(() => {
      void run();
    }, intervalMs);
    timer.unref?.();
    return timer;
  }

  async getOverview(): Promise<MonitoringOverview> {
    const [aggregate, riskOverview, snapshots, recentActions] = await Promise.all([
      this.getAggregateIndex(),
      this.distribution.getOverview(),
      this.repository.listSnapshots(48),
      this.repository.listActions({ page: 1, pageSize: 8 })
    ]);

    return {
      generatedAt: aggregate.generatedAt,
      thresholds: {
        observeIpCount: config.WELFARE_MONITOR_OBSERVE_IP_THRESHOLD,
        blockIpCount: config.WELFARE_MONITOR_BLOCK_IP_THRESHOLD,
        lockDurationMs: config.WELFARE_MONITOR_LOCK_DURATION_MS,
        liveCacheTtlMs: config.WELFARE_MONITOR_LIVE_CACHE_TTL_MS,
        snapshotIntervalMs: config.WELFARE_MONITOR_SNAPSHOT_INTERVAL_MS
      },
      summary: {
        rawRequestCount24h: aggregate.summary.rawRequestCount24h,
        requestCount24h: aggregate.summary.requestCount24h,
        excludedCount24h: aggregate.summary.excludedCount24h,
        activeUserCount24h: aggregate.summary.activeUserCount24h,
        uniqueIpCount24h: aggregate.summary.uniqueIpCount24h,
        observeUserCount1h: aggregate.summary.observeUserCount1h,
        blockedUserCount: riskOverview.activeEventCount,
        pendingReleaseCount: riskOverview.pendingReleaseCount,
        sharedIpCount1h: aggregate.summary.sharedIpCount1h,
        sharedIpCount24h: aggregate.summary.sharedIpCount24h
      },
      excludedBreakdown: aggregate.excludedBreakdown,
      windows: {
        observeUserCount1h: aggregate.summary.observeUserCount1h,
        observeUserCount24h: aggregate.summary.observeUserCount24h,
        sharedUserCount24h: aggregate.summary.sharedUserCount24h,
        sharedIpCount1h: aggregate.summary.sharedIpCount1h,
        sharedIpCount24h: aggregate.summary.sharedIpCount24h
      },
      usageSyncState: aggregate.usageSyncState,
      lastScan: riskOverview.lastScan,
      snapshotPoints: snapshots.map((item) => buildSnapshotPoint(item)),
      recentActions: recentActions.items
    };
  }

  async listIps(params: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ items: MonitoringIpItem[]; total: number; generatedAt: string }> {
    const aggregate = await this.getAggregateIndex();
    const normalizedSearch = normalizeIp(params.search);
    const matchedIps = normalizedSearch
      ? aggregate.ips.filter((item) => item.ipAddress.includes(normalizedSearch))
      : aggregate.ips;
    const offset = (params.page - 1) * params.pageSize;
    return {
      items: matchedIps.slice(offset, offset + params.pageSize),
      total: matchedIps.length,
      generatedAt: aggregate.generatedAt
    };
  }

  async getIpUsers(ipAddress: string): Promise<{
    ip: MonitoringIpItem;
    users: MonitoringIpUserItem[];
    generatedAt: string;
  }> {
    const { target, generatedAt } = await this.getIpDetailOrThrow(ipAddress);
    const { users, ...ip } = target;
    return {
      ip,
      users,
      generatedAt
    };
  }

  async getIpCloudflareStatus(ipAddress: string): Promise<MonitoringIpCloudflareStatus> {
    const { target } = await this.getIpDetailOrThrow(ipAddress);
    return this.inspectIpCloudflareRule(target.ipAddress);
  }

  async getIpDetailView(ipAddress: string): Promise<MonitoringIpDetailView> {
    const { target, generatedAt } = await this.getIpDetailOrThrow(ipAddress);
    const [cloudflare, recentActions] = await Promise.all([
      this.inspectIpCloudflareRule(target.ipAddress),
      this.listRecentActionsForContext({
        ipAddress: target.ipAddress,
        userIds: target.users.map((item) => item.sub2apiUserId)
      })
    ]);
    const { users, ...ip } = target;
    return {
      ip,
      users,
      cloudflare,
      recentActions,
      generatedAt
    };
  }

  async listUsers(params: {
    page: number;
    pageSize: number;
  }): Promise<{ items: MonitoringUserItem[]; total: number; generatedAt: string }> {
    const aggregate = await this.getAggregateIndex();
    const offset = (params.page - 1) * params.pageSize;
    return {
      items: aggregate.users.slice(offset, offset + params.pageSize),
      total: aggregate.users.length,
      generatedAt: aggregate.generatedAt
    };
  }

  async getUserIps(userId: number): Promise<{
    user: MonitoringUserItem;
    ips: MonitoringUserIpItem[];
    generatedAt: string;
  }> {
    const aggregate = await this.getAggregateIndex();
    const target = aggregate.users.find((item) => item.sub2apiUserId === userId);
    if (!target) {
      throw new MonitoringNotFoundError('未找到该用户的监控数据');
    }

    const { ips, ...user } = target;
    return {
      user,
      ips,
      generatedAt: aggregate.generatedAt
    };
  }

  async getUserDetailView(userId: number): Promise<MonitoringUserDetailView> {
    const aggregate = await this.getAggregateIndex();
    const target = aggregate.users.find((item) => item.sub2apiUserId === userId);
    if (!target) {
      throw new MonitoringNotFoundError('未找到该用户的监控数据');
    }

    const [openRiskEvent, recentActions] = await Promise.all([
      this.riskRepository.getBlockingEventByUserId(userId),
      this.listRecentActionsForContext({
        userIds: [userId]
      })
    ]);
    const { ips, ...user } = target;
    return {
      user,
      ips,
      openRiskEvent,
      recentActions,
      generatedAt: aggregate.generatedAt
    };
  }

  async listActions(params: {
    page: number;
    pageSize: number;
    actionType?: MonitoringActionType;
  }): Promise<{ items: MonitoringActionItem[]; total: number }> {
    return this.repository.listActions(params);
  }

  async disableUser(
    userId: number,
    operator: {
      sub2apiUserId: number;
      email: string;
      username: string;
    },
    reason: string
  ): Promise<AdminUserRecord> {
    if (userId === operator.sub2apiUserId) {
      throw new MonitoringConflictError('不能禁用当前登录管理员');
    }

    const target = await this.sub2api.getAdminUserById(userId);
    if (!target) {
      throw new MonitoringNotFoundError('目标用户不存在');
    }

    if (await this.isProtectedUser(target)) {
      throw new MonitoringConflictError('目标用户属于管理员保护范围，禁止禁用');
    }

    const updated =
      normalizeUserStatus(target.status) === 'disabled'
        ? target
        : await this.sub2api.updateAdminUserStatus(userId, 'disabled');

    await this.sessionState.bumpSessionVersion(userId);
    await this.repository.createAction({
      actionType: 'disable_user',
      targetType: 'user',
      targetId: userId,
      targetLabel: target.username || target.email,
      operatorSub2apiUserId: operator.sub2apiUserId,
      operatorEmail: operator.email,
      operatorUsername: operator.username,
      reason,
      resultStatus: 'success',
      detail: '已手动禁用用户，并强制失效福利站会话',
      metadata: {
        previous_status: normalizeUserStatus(target.status),
        next_status: normalizeUserStatus(updated.status)
      }
    });
    this.invalidateCache();
    return updated;
  }

  async enableUser(
    userId: number,
    operator: {
      sub2apiUserId: number;
      email: string;
      username: string;
    },
    reason: string
  ): Promise<AdminUserRecord> {
    const target = await this.sub2api.getAdminUserById(userId);
    if (!target) {
      throw new MonitoringNotFoundError('目标用户不存在');
    }

    const blockingEvent = await this.riskRepository.getBlockingEventByUserId(userId);
    if (blockingEvent) {
      throw new MonitoringConflictError('该用户仍存在未释放风险事件，请先在风险事件区执行恢复');
    }

    const updated =
      normalizeUserStatus(target.status) === 'active'
        ? target
        : await this.sub2api.updateAdminUserStatus(userId, 'active');

    await this.repository.createAction({
      actionType: 'enable_user',
      targetType: 'user',
      targetId: userId,
      targetLabel: target.username || target.email,
      operatorSub2apiUserId: operator.sub2apiUserId,
      operatorEmail: operator.email,
      operatorUsername: operator.username,
      reason,
      resultStatus: 'success',
      detail: '已手动恢复用户状态为 active',
      metadata: {
        previous_status: normalizeUserStatus(target.status),
        next_status: normalizeUserStatus(updated.status)
      }
    });
    this.invalidateCache();
    return updated;
  }

  async challengeIp(
    ipAddress: string,
    operator: {
      sub2apiUserId: number;
      email: string;
      username: string;
    },
    reason: string
  ): Promise<MonitoringIpCloudflareStatus> {
    return this.applyCloudflareRule(ipAddress, operator, reason, {
      actionType: 'cloudflare_challenge_ip',
      mode: 'managed_challenge'
    });
  }

  async blockIp(
    ipAddress: string,
    operator: {
      sub2apiUserId: number;
      email: string;
      username: string;
    },
    reason: string
  ): Promise<MonitoringIpCloudflareStatus> {
    return this.applyCloudflareRule(ipAddress, operator, reason, {
      actionType: 'cloudflare_block_ip',
      mode: 'block'
    });
  }

  async unblockIp(
    ipAddress: string,
    operator: {
      sub2apiUserId: number;
      email: string;
      username: string;
    },
    reason: string
  ): Promise<MonitoringIpCloudflareStatus> {
    const { target } = await this.getIpDetailOrThrow(ipAddress);

    try {
      const inspection = await this.inspectIpCloudflareRule(target.ipAddress);
      if (!inspection.enabled) {
        await this.recordCloudflareAction(operator, {
          actionType: 'cloudflare_unblock_ip',
          ipAddress: target.ipAddress,
          reason,
          resultStatus: 'blocked',
          detail: inspection.disabledReason,
          metadata: {
            matched_rule_count: inspection.matchedRuleCount
          }
        });
        throw new MonitoringFeatureUnavailableError(inspection.disabledReason);
      }

      if (!inspection.canManage) {
        await this.recordCloudflareAction(operator, {
          actionType: 'cloudflare_unblock_ip',
          ipAddress: target.ipAddress,
          reason,
          resultStatus: 'blocked',
          detail: inspection.disabledReason,
          metadata: {
            matched_rule_count: inspection.matchedRuleCount,
            cloudflare_rule_id: inspection.rule?.id ?? null,
            current_mode: inspection.rule?.mode ?? null,
            rule_source: inspection.rule?.source ?? null
          }
        });
        throw new MonitoringConflictError(inspection.disabledReason);
      }

      if (!inspection.rule) {
        const result = {
          ...inspection,
          rule: null
        };
        await this.recordCloudflareAction(operator, {
          actionType: 'cloudflare_unblock_ip',
          ipAddress: target.ipAddress,
          reason,
          resultStatus: 'success',
          detail: '未发现由福利站托管的 Cloudflare 规则，无需解除',
          metadata: {
            matched_rule_count: 0
          }
        });
        return result;
      }

      await this.cloudflare.deleteIpAccessRule(inspection.rule.id);
      const nextStatus = {
        ...inspection,
        matchedRuleCount: 0,
        rule: null
      };
      await this.recordCloudflareAction(operator, {
        actionType: 'cloudflare_unblock_ip',
        ipAddress: target.ipAddress,
        reason,
        resultStatus: 'success',
        detail: `已解除该 IP 的 Cloudflare ${describeCloudflareMode(inspection.rule.mode)}规则`,
        metadata: {
          matched_rule_count: inspection.matchedRuleCount,
          cloudflare_rule_id: inspection.rule.id,
          previous_mode: inspection.rule.mode,
          rule_source: inspection.rule.source
        }
      });
      return nextStatus;
    } catch (error) {
      if (
        error instanceof MonitoringFeatureUnavailableError ||
        error instanceof MonitoringConflictError
      ) {
        throw error;
      }
      throw await this.handleCloudflareActionFailure(
        error,
        operator,
        'cloudflare_unblock_ip',
        target.ipAddress,
        reason
      );
    }
  }

  async recordRiskScanAction(
    operator: {
      sub2apiUserId: number;
      email: string;
      username: string;
    },
    input: {
      matchedUserCount: number;
      createdEventCount: number;
      refreshedEventCount: number;
      status: 'success' | 'failed';
      detail: string;
    }
  ): Promise<void> {
    await this.repository.createAction({
      actionType: 'run_risk_scan',
      targetType: 'scan',
      targetId: null,
      targetLabel: 'manual-risk-scan',
      operatorSub2apiUserId: operator.sub2apiUserId,
      operatorEmail: operator.email,
      operatorUsername: operator.username,
      reason: '',
      resultStatus: input.status,
      detail: input.detail,
      metadata: {
        matched_user_count: input.matchedUserCount,
        created_event_count: input.createdEventCount,
        refreshed_event_count: input.refreshedEventCount
      }
    });
    this.invalidateCache();
  }

  async recordRiskReleaseAction(
    operator: {
      sub2apiUserId: number;
      email: string;
      username: string;
    },
    input: {
      eventId: number;
      userId: number;
      targetLabel: string;
      reason: string;
    }
  ): Promise<void> {
    await this.repository.createAction({
      actionType: 'release_risk_event',
      targetType: 'risk_event',
      targetId: input.eventId,
      targetLabel: input.targetLabel,
      operatorSub2apiUserId: operator.sub2apiUserId,
      operatorEmail: operator.email,
      operatorUsername: operator.username,
      reason: input.reason,
      resultStatus: 'success',
      detail: `已手动恢复风险事件用户 #${input.userId}`,
      metadata: {
        sub2api_user_id: input.userId
      }
    });
    this.invalidateCache();
  }

  private async applyCloudflareRule(
    ipAddress: string,
    operator: {
      sub2apiUserId: number;
      email: string;
      username: string;
    },
    reason: string,
    input: {
      actionType: Extract<
        MonitoringActionType,
        'cloudflare_challenge_ip' | 'cloudflare_block_ip'
      >;
      mode: Extract<CloudflareIpAccessMode, 'managed_challenge' | 'block'>;
    }
  ): Promise<MonitoringIpCloudflareStatus> {
    const { target } = await this.getIpDetailOrThrow(ipAddress);

    try {
      const inspection = await this.inspectIpCloudflareRule(target.ipAddress);
      if (!inspection.enabled) {
        await this.recordCloudflareAction(operator, {
          actionType: input.actionType,
          ipAddress: target.ipAddress,
          reason,
          resultStatus: 'blocked',
          detail: inspection.disabledReason,
          metadata: {
            matched_rule_count: inspection.matchedRuleCount
          }
        });
        throw new MonitoringFeatureUnavailableError(inspection.disabledReason);
      }

      if (!inspection.canManage) {
        await this.recordCloudflareAction(operator, {
          actionType: input.actionType,
          ipAddress: target.ipAddress,
          reason,
          resultStatus: 'blocked',
          detail: inspection.disabledReason,
          metadata: {
            matched_rule_count: inspection.matchedRuleCount,
            cloudflare_rule_id: inspection.rule?.id ?? null,
            current_mode: inspection.rule?.mode ?? null,
            rule_source: inspection.rule?.source ?? null
          }
        });
        throw new MonitoringConflictError(inspection.disabledReason);
      }

      const notes = this.buildCloudflareNotes(input.mode, operator, reason);
      const previousMode = inspection.rule?.mode ?? null;
      const rule =
        inspection.rule == null
          ? await this.cloudflare.createIpAccessRule({
              ipAddress: target.ipAddress,
              mode: input.mode,
              notes
            })
          : await this.cloudflare.updateIpAccessRule({
              ruleId: inspection.rule.id,
              mode: input.mode,
              notes
            });

      const detail =
        previousMode == null
          ? `已为该 IP 开启 Cloudflare ${describeCloudflareMode(rule.mode)}`
          : previousMode === rule.mode
            ? `该 IP 已存在 Cloudflare ${describeCloudflareMode(rule.mode)}，已刷新备注`
            : `已将该 IP 的 Cloudflare 规则从 ${describeCloudflareMode(previousMode)}调整为 ${describeCloudflareMode(rule.mode)}`;

      const result = this.buildCloudflareStatus(target.ipAddress, {
        enabled: true,
        canManage: true,
        disabledReason: '',
        matchedRuleCount: 1,
        rule: {
          ...rule,
          source: 'managed'
        }
      });

      await this.recordCloudflareAction(operator, {
        actionType: input.actionType,
        ipAddress: target.ipAddress,
        reason,
        resultStatus: 'success',
        detail,
        metadata: {
          matched_rule_count: inspection.matchedRuleCount,
          cloudflare_rule_id: rule.id,
          previous_mode: previousMode,
          next_mode: rule.mode,
          rule_source: 'managed'
        }
      });

      return result;
    } catch (error) {
      if (
        error instanceof MonitoringFeatureUnavailableError ||
        error instanceof MonitoringConflictError
      ) {
        throw error;
      }

      throw await this.handleCloudflareActionFailure(
        error,
        operator,
        input.actionType,
        target.ipAddress,
        reason
      );
    }
  }

  async captureSnapshot(): Promise<MonitoringSnapshot> {
    const [aggregate, riskOverview] = await Promise.all([
      this.getAggregateIndex(true),
      this.distribution.getOverview()
    ]);
    await this.repository.purgeSnapshotsOlderThan(config.WELFARE_MONITOR_SNAPSHOT_RETENTION_DAYS);
    return this.repository.saveSnapshot({
      snapshotAt: aggregate.generatedAt,
      rawRequestCount24h: aggregate.summary.rawRequestCount24h,
      requestCount24h: aggregate.summary.requestCount24h,
      activeUserCount24h: aggregate.summary.activeUserCount24h,
      uniqueIpCount24h: aggregate.summary.uniqueIpCount24h,
      observeUserCount1h: aggregate.summary.observeUserCount1h,
      blockedUserCount: riskOverview.activeEventCount,
      pendingReleaseCount: riskOverview.pendingReleaseCount,
      sharedIpCount1h: aggregate.summary.sharedIpCount1h,
      sharedIpCount24h: aggregate.summary.sharedIpCount24h
    });
  }

  private async listRecentActionsForContext(input: {
    ipAddress?: string;
    userIds?: number[];
  }): Promise<MonitoringActionItem[]> {
    const userIds = new Set(input.userIds ?? []);
    const recent = await this.repository.listActions({ page: 1, pageSize: 50 });
    return recent.items
      .filter((item) => {
        const metadataUserId = Number(item.metadata.user_id ?? item.metadata.sub2api_user_id ?? 0);
        const metadataIp = String(item.metadata.ip_address ?? '').trim().toLowerCase();
        if (input.ipAddress && (item.targetLabel === input.ipAddress || metadataIp === input.ipAddress)) {
          return true;
        }
        if (userIds.size > 0) {
          if ((item.targetType === 'user' || item.targetType === 'risk_event') && item.targetId && userIds.has(item.targetId)) {
            return true;
          }
          if (Number.isInteger(metadataUserId) && userIds.has(metadataUserId)) {
            return true;
          }
        }
        return false;
      })
      .slice(0, 10);
  }

  private async getIpDetailOrThrow(ipAddress: string): Promise<{
    target: MonitoringIpDetail;
    generatedAt: string;
  }> {
    const normalizedIp = normalizeIp(ipAddress);
    if (!normalizedIp) {
      throw new MonitoringNotFoundError('IP 不存在');
    }

    const aggregate = await this.getAggregateIndex();
    const target = aggregate.ips.find((item) => item.ipAddress === normalizedIp);
    if (!target) {
      throw new MonitoringNotFoundError('未找到该 IP 的监控数据');
    }

    return {
      target,
      generatedAt: aggregate.generatedAt
    };
  }

  private async inspectIpCloudflareRule(ipAddress: string): Promise<MonitoringIpCloudflareStatus> {
    if (!this.cloudflare.isConfigured()) {
      return this.buildCloudflareStatus(ipAddress, {
        enabled: false,
        canManage: false,
        disabledReason: this.cloudflare.getDisabledReason(),
        matchedRuleCount: 0,
        rule: null
      });
    }

    try {
      const rules = await this.cloudflare.listIpAccessRules(ipAddress);
      const managedRules = rules.filter((item) => isManagedCloudflareRule(item));
      const externalRules = rules.filter((item) => !isManagedCloudflareRule(item));

      if (
        managedRules.length > 1 ||
        externalRules.length > 1 ||
        (managedRules.length > 0 && externalRules.length > 0)
      ) {
        return this.buildCloudflareStatus(ipAddress, {
          enabled: true,
          canManage: false,
          disabledReason: '检测到多个 Cloudflare 规则命中该 IP。为避免误操作，请直接去 Cloudflare 后台处理。',
          matchedRuleCount: rules.length,
          rule: this.toCloudflareRuleSnapshot(managedRules[0] ?? externalRules[0] ?? null)
        });
      }

      if (externalRules.length === 1) {
        return this.buildCloudflareStatus(ipAddress, {
          enabled: true,
          canManage: false,
          disabledReason:
            '该 IP 已存在非福利站托管的 Cloudflare 规则。为避免覆盖，请直接去 Cloudflare 后台处理。',
          matchedRuleCount: 1,
          rule: this.toCloudflareRuleSnapshot(externalRules[0]!)
        });
      }

      if (managedRules.length === 1) {
        return this.buildCloudflareStatus(ipAddress, {
          enabled: true,
          canManage: true,
          disabledReason: '',
          matchedRuleCount: 1,
          rule: this.toCloudflareRuleSnapshot(managedRules[0]!)
        });
      }

      return this.buildCloudflareStatus(ipAddress, {
        enabled: true,
        canManage: true,
        disabledReason: '',
        matchedRuleCount: 0,
        rule: null
      });
    } catch (error) {
      if (error instanceof CloudflareClientConfigError) {
        return this.buildCloudflareStatus(ipAddress, {
          enabled: false,
          canManage: false,
          disabledReason: error.message,
          matchedRuleCount: 0,
          rule: null
        });
      }

      if (error instanceof CloudflareClientConflictError) {
        throw new MonitoringConflictError(error.message);
      }

      if (error instanceof CloudflareClientRequestError) {
        throw new MonitoringUpstreamError(`读取 Cloudflare 规则失败：${error.message}`);
      }

      throw error;
    }
  }

  private buildCloudflareStatus(
    ipAddress: string,
    input: Omit<MonitoringIpCloudflareStatus, 'ipAddress' | 'rule'> & {
      rule: CloudflareRuleSnapshot | null;
    }
  ): MonitoringIpCloudflareStatus {
    return {
      ipAddress,
      enabled: input.enabled,
      canManage: input.canManage,
      disabledReason: input.disabledReason,
      matchedRuleCount: input.matchedRuleCount,
      rule: input.rule
        ? {
            id: input.rule.id,
            mode: input.rule.mode,
            source: input.rule.source,
            notes: input.rule.notes,
            createdAt: input.rule.createdAt,
            modifiedAt: input.rule.modifiedAt
          }
        : null
    };
  }

  private toCloudflareRuleSnapshot(rule: CloudflareIpAccessRule | null): CloudflareRuleSnapshot | null {
    if (!rule) {
      return null;
    }

    return {
      ...rule,
      source: isManagedCloudflareRule(rule) ? 'managed' : 'external'
    };
  }

  private buildCloudflareNotes(
    mode: Extract<CloudflareIpAccessMode, 'managed_challenge' | 'block'>,
    operator: {
      sub2apiUserId: number;
      email: string;
      username: string;
    },
    reason: string
  ): string {
    const parts = [
      CLOUDFLARE_MANAGED_RULE_PREFIX.slice(0, -1),
      `mode=${mode}`,
      `operator_id=${operator.sub2apiUserId}`,
      `operator=${(operator.username || operator.email).trim() || operator.email}`,
      `at=${new Date().toISOString()}`
    ];
    const normalizedReason = reason.trim().replace(/\s+/g, ' ');
    if (normalizedReason) {
      parts.push(`reason=${normalizedReason}`);
    }
    return parts.join('|').slice(0, 500);
  }

  private async recordCloudflareAction(
    operator: {
      sub2apiUserId: number;
      email: string;
      username: string;
    },
    input: {
      actionType: Extract<
        MonitoringActionType,
        'cloudflare_challenge_ip' | 'cloudflare_block_ip' | 'cloudflare_unblock_ip'
      >;
      ipAddress: string;
      reason: string;
      resultStatus: 'success' | 'failed' | 'blocked';
      detail: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.repository.createAction({
      actionType: input.actionType,
      targetType: 'ip',
      targetId: null,
      targetLabel: input.ipAddress,
      operatorSub2apiUserId: operator.sub2apiUserId,
      operatorEmail: operator.email,
      operatorUsername: operator.username,
      reason: input.reason,
      resultStatus: input.resultStatus,
      detail: input.detail,
      metadata: {
        ip_address: input.ipAddress,
        ...(input.metadata ?? {})
      }
    });
  }

  private async handleCloudflareActionFailure(
    error: unknown,
    operator: {
      sub2apiUserId: number;
      email: string;
      username: string;
    },
    actionType: Extract<
      MonitoringActionType,
      'cloudflare_challenge_ip' | 'cloudflare_block_ip' | 'cloudflare_unblock_ip'
    >,
    ipAddress: string,
    reason: string
  ): Promise<Error> {
    if (error instanceof CloudflareClientConfigError) {
      await this.recordCloudflareAction(operator, {
        actionType,
        ipAddress,
        reason,
        resultStatus: 'blocked',
        detail: error.message
      });
      return new MonitoringFeatureUnavailableError(error.message);
    }

    if (error instanceof CloudflareClientConflictError) {
      await this.recordCloudflareAction(operator, {
        actionType,
        ipAddress,
        reason,
        resultStatus: 'blocked',
        detail: error.message
      });
      return new MonitoringConflictError(error.message);
    }

    if (error instanceof CloudflareClientRequestError) {
      await this.recordCloudflareAction(operator, {
        actionType,
        ipAddress,
        reason,
        resultStatus: 'failed',
        detail: `Cloudflare API 调用失败：${error.message}`
      });
      return new MonitoringUpstreamError(`Cloudflare 规则操作失败：${error.message}`);
    }

    return error instanceof Error ? error : new Error('Cloudflare 规则操作失败');
  }

  private invalidateCache() {
    this.aggregateCache = null;
    this.aggregateCachePromise = null;
  }

  private async getAggregateIndex(forceRefresh = false): Promise<MonitoringAggregateIndex> {
    const nowMs = Date.now();
    if (!forceRefresh && this.aggregateCache && this.aggregateCache.expiresAtMs > nowMs) {
      return this.aggregateCache.index;
    }

    if (!forceRefresh && this.aggregateCachePromise) {
      return this.aggregateCachePromise;
    }

    const task = this.loadAggregateIndex(nowMs, forceRefresh).finally(() => {
      if (this.aggregateCachePromise === task) {
        this.aggregateCachePromise = null;
      }
    });
    this.aggregateCachePromise = task;
    return task;
  }

  private async loadAggregateIndex(
    nowMs: number,
    forceRefresh: boolean
  ): Promise<MonitoringAggregateIndex> {
    const [usageSnapshot, openRiskEvents, protectedUsers] = await Promise.all([
      this.usageAnalysis.getSnapshot(forceRefresh),
      this.riskRepository.listRiskEventsForStatuses(['active', 'pending_release'], 1000),
      this.getProtectedState()
    ]);

    const index = buildMonitoringAggregateIndex({
      entries: usageSnapshot.entries,
      rawUsageCount24h: usageSnapshot.rawUsageCount24h,
      excludedCount24h: usageSnapshot.excludedCount24h,
      excludedBreakdown: usageSnapshot.excludedBreakdown,
      usageSyncState: usageSnapshot.usageSyncState,
      nowMs,
      observeIpThreshold: config.WELFARE_MONITOR_OBSERVE_IP_THRESHOLD,
      blockIpThreshold: config.WELFARE_MONITOR_BLOCK_IP_THRESHOLD,
      openRiskEvents: openRiskEvents
        .filter((item): item is typeof item & { status: 'active' | 'pending_release' } =>
          item.status === 'active' || item.status === 'pending_release'
        )
        .map((item) => ({
          id: item.id,
          sub2apiUserId: item.sub2apiUserId,
          status: item.status
        })),
      protectedUsers
    });

    this.aggregateCache = {
      index,
      expiresAtMs: nowMs + config.WELFARE_MONITOR_LIVE_CACHE_TTL_MS
    };

    return index;
  }

  private async getProtectedState(): Promise<MonitoringProtectedState> {
    const whitelist = await this.welfare.listAdminWhitelist();
    return {
      protectedUserIds: new Set(
        whitelist
          .map((item) => item.sub2apiUserId)
          .filter((item): item is number => typeof item === 'number' && item > 0)
      ),
      protectedSubjects: new Set(
        whitelist
          .map((item) => item.linuxdoSubject?.trim())
          .filter((item): item is string => Boolean(item))
      )
    };
  }

  private async isProtectedUser(user: AdminUserRecord): Promise<boolean> {
    const protectedState = await this.getProtectedState();
    const subject = extractLinuxDoSubjectFromEmail(user.email);
    return (
      normalizeUserRole(user.role) === 'admin' ||
      protectedState.protectedUserIds.has(user.id) ||
      (subject != null && protectedState.protectedSubjects.has(subject))
    );
  }
}

const repository = new MonitoringRepository(pool);
const riskRepository = new RiskRepository(pool);

export const monitoringService = new MonitoringService(
  repository,
  riskRepository,
  sessionStateService,
  sub2apiClient,
  new WelfareRepository(pool),
  distributionDetectionService,
  cloudflareClient,
  console
);

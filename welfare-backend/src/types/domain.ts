export interface SessionUser {
  sub2apiUserId: number;
  email: string;
  linuxdoSubject: string | null;
  username: string;
  avatarUrl: string | null;
}

export interface SessionTokenUser extends SessionUser {
  sessionVersion: number;
}

export interface VerifiedSession {
  user: SessionUser;
  tokenId: string;
  expiresAtMs: number;
  sessionVersion: number;
}

export interface UserSecurityState {
  sub2apiUserId: number;
  sessionVersion: number;
  createdAt: string;
  updatedAt: string;
}

export type RiskEventStatus = 'active' | 'pending_release' | 'released';
export type RiskSyncStatus = 'pending' | 'success' | 'failed';
export type RiskScanStateStatus = 'idle' | 'running' | 'success' | 'failed';
export type RiskBand = 'normal' | 'observe' | 'block';
export type RiskRuleHitLevel = 'info' | 'warn' | 'high';
export type MonitoringActionType =
  | 'disable_user'
  | 'enable_user'
  | 'release_risk_event'
  | 'run_risk_scan'
  | 'cloudflare_challenge_ip'
  | 'cloudflare_block_ip'
  | 'cloudflare_unblock_ip';
export type MonitoringActionTargetType = 'user' | 'risk_event' | 'scan' | 'ip';
export type MonitoringActionResultStatus = 'success' | 'failed' | 'blocked';

export interface RiskRuleHit {
  code: string;
  label: string;
  level: RiskRuleHitLevel;
  window: '10m' | '1h' | '3h' | '6h' | '24h';
  actual: number;
  threshold: number;
  score: number;
}

export interface RiskEvent {
  id: number;
  sub2apiUserId: number;
  sub2apiEmail: string;
  sub2apiUsername: string;
  linuxdoSubject: string | null;
  sub2apiRole: 'admin' | 'user';
  sub2apiStatus: string;
  eventType: 'distribution_ip';
  status: RiskEventStatus;
  windowStartedAt: string;
  windowEndedAt: string;
  distinctIpCount: number;
  ipSamples: string[];
  riskScore: number;
  riskBand: RiskBand;
  ruleHits: RiskRuleHit[];
  firstHitAt: string;
  lastHitAt: string;
  minimumLockUntil: string;
  mainSiteSyncStatus: RiskSyncStatus;
  mainSiteSyncError: string;
  lastScanStatus: 'success' | 'failed';
  lastScanError: string;
  lastScanSource: string;
  lastScannedAt: string | null;
  releasedBySub2apiUserId: number | null;
  releasedByEmail: string;
  releasedByUsername: string;
  releaseReason: string;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RiskScanState {
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: RiskScanStateStatus;
  lastError: string;
  lastTriggerSource: string;
  scannedUserCount: number;
  hitUserCount: number;
  updatedAt: string;
}

export interface MonitoringSnapshot {
  id: number;
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
  createdAt: string;
}

export interface MonitoringAction {
  id: number;
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
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UsageSyncState {
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: RiskScanStateStatus;
  lastError: string;
  fetchedPageCount: number;
  upsertedCount: number;
  updatedAt: string;
}

export type CheckinMode = 'normal' | 'blindbox';

export interface WelfareSettings {
  checkinEnabled: boolean;
  blindboxEnabled: boolean;
  dailyRewardMinBalance: number;
  dailyRewardMaxBalance: number;
  timezone: string;
  resetEnabled: boolean;
  resetThresholdBalance: number;
  resetTargetBalance: number;
  resetCooldownDays: number;
  resetNotice: string;
}

export interface BlindboxItem {
  id: number;
  title: string;
  rewardBalance: number;
  weight: number;
  enabled: boolean;
  notes: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CheckinRecord {
  id: number;
  sub2apiUserId: number;
  sub2apiEmail: string;
  sub2apiUsername: string;
  linuxdoSubject: string | null;
  checkinDate: string;
  checkinMode: CheckinMode;
  blindboxItemId: number | null;
  blindboxTitle: string;
  rewardBalance: number;
  idempotencyKey: string;
  grantStatus: 'pending' | 'success' | 'failed';
  grantError: string;
  sub2apiRequestId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RedeemCode {
  id: number;
  code: string;
  title: string;
  rewardBalance: number;
  maxClaims: number;
  claimedCount: number;
  enabled: boolean;
  expiresAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface RedeemClaim {
  id: number;
  redeemCodeId: number;
  sub2apiUserId: number;
  sub2apiEmail: string;
  sub2apiUsername: string;
  linuxdoSubject: string | null;
  redeemCode: string;
  redeemTitle: string;
  rewardBalance: number;
  idempotencyKey: string;
  grantStatus: 'pending' | 'success' | 'failed';
  grantError: string;
  sub2apiRequestId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResetRecord {
  id: number;
  sub2apiUserId: number;
  sub2apiEmail: string;
  sub2apiUsername: string;
  linuxdoSubject: string | null;
  beforeBalance: number;
  thresholdBalance: number;
  targetBalance: number;
  grantedBalance: number;
  newBalance: number | null;
  cooldownDays: number;
  idempotencyKey: string;
  grantStatus: 'pending' | 'success' | 'failed';
  grantError: string;
  sub2apiRequestId: string;
  createdAt: string;
  updatedAt: string;
}

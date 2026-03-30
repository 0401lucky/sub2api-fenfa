export interface SessionUser {
  sub2apiUserId: number;
  email: string;
  linuxdoSubject: string | null;
  username: string;
  avatarUrl: string | null;
}

export interface VerifiedSession {
  user: SessionUser;
  tokenId: string;
  expiresAtMs: number;
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

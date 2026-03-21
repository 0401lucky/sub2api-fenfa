export interface SessionUser {
  sub2apiUserId: number;
  linuxdoSubject: string;
  syntheticEmail: string;
  username: string;
  avatarUrl: string | null;
}

export interface WelfareSettings {
  checkinEnabled: boolean;
  dailyRewardBalance: number;
  timezone: string;
}

export interface CheckinRecord {
  id: number;
  sub2apiUserId: number;
  linuxdoSubject: string;
  syntheticEmail: string;
  checkinDate: string;
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
  linuxdoSubject: string;
  syntheticEmail: string;
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

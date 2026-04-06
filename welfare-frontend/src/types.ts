export interface ApiEnvelope<T> {
  code: number;
  message: string;
  detail?: string;
  data: T;
}

export type CheckinMode = 'normal' | 'blindbox';

export interface SessionUser {
  sub2api_user_id: number;
  email: string;
  linuxdo_subject: string | null;
  username: string;
  avatar_url: string | null;
  is_admin: boolean;
}

export interface BlindboxPreviewItem {
  id: number;
  title: string;
  reward_balance: number;
}

export interface BlindboxPreview {
  item_count: number;
  min_reward: number | null;
  max_reward: number | null;
  items: BlindboxPreviewItem[];
}

export interface BlindboxResult {
  item_id: number | null;
  title: string | null;
}

export interface CheckinStatus {
  checkin_enabled: boolean;
  blindbox_enabled: boolean;
  timezone: string;
  checkin_date: string;
  daily_reward_min_balance: number;
  daily_reward_max_balance: number;
  checked_in: boolean;
  selected_mode: CheckinMode | null;
  can_checkin_normal: boolean;
  can_checkin_blindbox: boolean;
  grant_status: 'pending' | 'success' | 'failed' | null;
  checked_at: string | null;
  reward_balance: number | null;
  blindbox_preview: BlindboxPreview;
  blindbox_result: BlindboxResult | null;
}

export interface CheckinHistoryItem {
  id: number;
  checkin_date: string;
  checkin_mode: CheckinMode;
  blindbox_title: string | null;
  reward_balance: number;
  grant_status: 'pending' | 'success' | 'failed';
  grant_error: string;
  created_at: string;
}

export interface RedeemHistoryItem {
  id: number;
  redeem_code_id: number;
  redeem_code: string;
  redeem_title: string;
  reward_balance: number;
  grant_status: 'pending' | 'success' | 'failed';
  grant_error: string;
  created_at: string;
}

export interface AdminSettings {
  checkin_enabled: boolean;
  blindbox_enabled: boolean;
  daily_reward_min_balance: number;
  daily_reward_max_balance: number;
  timezone: string;
  reset_enabled: boolean;
  reset_threshold_balance: number;
  reset_target_balance: number;
  reset_cooldown_days: number;
  reset_notice: string;
}

export interface ResetRecordSummary {
  id: number;
  before_balance: number;
  threshold_balance: number;
  target_balance: number;
  granted_balance: number;
  new_balance: number | null;
  cooldown_days: number;
  grant_status: 'pending' | 'success' | 'failed';
  grant_error: string;
  created_at: string;
  updated_at: string;
}

export interface ResetStatus {
  reset_enabled: boolean;
  current_balance: number;
  threshold_balance: number;
  target_balance: number;
  cooldown_days: number;
  notice: string;
  can_apply: boolean;
  reason: string;
  next_available_at: string | null;
  latest_record: ResetRecordSummary | null;
}

export interface ResetHistoryItem {
  id: number;
  before_balance: number;
  threshold_balance: number;
  target_balance: number;
  granted_balance: number;
  new_balance: number | null;
  cooldown_days: number;
  grant_status: 'pending' | 'success' | 'failed';
  grant_error: string;
  created_at: string;
  updated_at: string;
}

export interface DailyStatPoint {
  checkinDate: string;
  checkinUsers: number;
  grantTotal: number;
}

export interface DailyStats {
  days: number;
  active_users: number;
  total_checkins: number;
  total_grant_balance: number;
  points: DailyStatPoint[];
}

export interface AdminOverview {
  settings: AdminSettings;
  stats: DailyStats;
  whitelist: WhitelistItem[];
}

export interface AdminRiskScanState {
  last_started_at: string | null;
  last_finished_at: string | null;
  last_status: 'idle' | 'running' | 'success' | 'failed';
  last_error: string;
  last_trigger_source: string;
  scanned_user_count: number;
  hit_user_count: number;
  updated_at: string;
}

export interface AdminRiskOverview {
  active_event_count: number;
  pending_release_count: number;
  open_event_count: number;
  observe_count_1h: number;
  windows: {
    window_1h_observe_count: number;
    window_3h_observe_count: number;
    window_6h_observe_count: number;
    window_24h_observe_count: number;
  };
  last_scan: AdminRiskScanState;
}

export interface AdminRiskObservation {
  sub2api_user_id: number;
  sub2api_email: string;
  sub2api_username: string;
  linuxdo_subject: string | null;
  sub2api_role: 'admin' | 'user';
  sub2api_status: string;
  window_1h_ip_count: number;
  window_3h_ip_count: number;
  window_6h_ip_count: number;
  window_24h_ip_count: number;
  ip_samples: string[];
  risk_score: number;
  risk_band: 'normal' | 'observe' | 'block';
  rule_hits: AdminRiskRuleHit[];
  first_hit_at: string;
  last_hit_at: string;
}

export interface AdminRiskObservationList {
  items: AdminRiskObservation[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface AdminRiskEvent {
  id: number;
  sub2apiUserId: number;
  sub2apiEmail: string;
  sub2apiUsername: string;
  linuxdoSubject: string | null;
  sub2apiRole: 'admin' | 'user';
  sub2apiStatus: string;
  status: 'active' | 'pending_release' | 'released';
  windowStartedAt: string;
  windowEndedAt: string;
  distinctIpCount: number;
  ipSamples: string[];
  riskScore: number;
  riskBand: 'normal' | 'observe' | 'block';
  ruleHits: AdminRiskRuleHit[];
  firstHitAt: string;
  lastHitAt: string;
  minimumLockUntil: string;
  mainSiteSyncStatus: 'pending' | 'success' | 'failed';
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

export interface AdminRiskEventList {
  items: AdminRiskEvent[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface AdminRiskEventQuery {
  page?: number;
  page_size?: number;
  status?: 'active' | 'pending_release' | 'released';
}

export interface AdminRiskScanResult {
  scanned_log_count: number;
  matched_user_count: number;
  created_event_count: number;
  refreshed_event_count: number;
  skipped_admin_count: number;
  retried_main_site_count: number;
  last_scan: AdminRiskScanState;
}

export type AdminMonitoringActionType =
  | 'disable_user'
  | 'enable_user'
  | 'release_risk_event'
  | 'run_risk_scan'
  | 'cloudflare_challenge_ip'
  | 'cloudflare_block_ip'
  | 'cloudflare_unblock_ip';

export interface AdminRiskRuleHit {
  code: string;
  label: string;
  level: 'info' | 'warn' | 'high';
  window: '10m' | '1h' | '3h' | '6h' | '24h';
  actual: number;
  threshold: number;
  score: number;
}

export interface AdminMonitoringSnapshotPoint {
  snapshot_at: string;
  raw_request_count_24h: number;
  request_count_24h: number;
  active_user_count_24h: number;
  unique_ip_count_24h: number;
  observe_user_count_1h: number;
  blocked_user_count: number;
  pending_release_count: number;
  shared_ip_count_1h: number;
  shared_ip_count_24h: number;
}

export interface AdminMonitoringActionItem {
  id: number;
  action_type: AdminMonitoringActionType;
  target_type: 'user' | 'risk_event' | 'scan' | 'ip';
  target_id: number | null;
  target_label: string;
  operator_sub2api_user_id: number;
  operator_email: string;
  operator_username: string;
  reason: string;
  result_status: 'success' | 'failed' | 'blocked';
  detail: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AdminMonitoringActionList {
  items: AdminMonitoringActionItem[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface AdminMonitoringOverview {
  generated_at: string;
  thresholds: {
    observe_ip_count: number;
    block_ip_count: number;
    lock_duration_ms: number;
    live_cache_ttl_ms: number;
    snapshot_interval_ms: number;
  };
  summary: {
    raw_request_count_24h: number;
    request_count_24h: number;
    excluded_request_count_24h: number;
    active_user_count_24h: number;
    unique_ip_count_24h: number;
    observe_user_count_1h: number;
    blocked_user_count: number;
    pending_release_count: number;
    shared_ip_count_1h: number;
    shared_ip_count_24h: number;
  };
  excluded_breakdown: {
    invalid_created_at: number;
    missing_user_id: number;
    missing_ip_address: number;
    outside_window: number;
  };
  windows: {
    observe_user_count_1h: number;
    observe_user_count_24h: number;
    shared_user_count_24h: number;
    shared_ip_count_1h: number;
    shared_ip_count_24h: number;
  };
  usage_sync: {
    last_started_at: string | null;
    last_finished_at: string | null;
    last_status: 'idle' | 'running' | 'success' | 'failed';
    last_error: string;
    fetched_page_count: number;
    upserted_count: number;
    updated_at: string;
  };
  last_scan: AdminRiskScanState;
  snapshot_points: AdminMonitoringSnapshotPoint[];
  recent_actions: AdminMonitoringActionItem[];
}

export interface AdminMonitoringIpSampleUser {
  sub2api_user_id: number;
  sub2api_username: string;
  sub2api_email: string;
}

export interface AdminMonitoringIpItem {
  ip_address: string;
  request_count_10m: number;
  request_count_1h: number;
  request_count_24h: number;
  user_count_10m: number;
  user_count_1h: number;
  user_count_24h: number;
  first_seen_at: string;
  last_seen_at: string;
  risk_level: 'normal' | 'observe' | 'block';
  risk_score: number;
  risk_band: 'normal' | 'observe' | 'block';
  rule_hits: AdminRiskRuleHit[];
  sample_users: AdminMonitoringIpSampleUser[];
}

export interface AdminMonitoringIpList {
  items: AdminMonitoringIpItem[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  generated_at: string;
  search?: string;
}

export interface AdminMonitoringIpUserItem {
  sub2api_user_id: number;
  sub2api_email: string;
  sub2api_username: string;
  linuxdo_subject: string | null;
  sub2api_role: 'admin' | 'user';
  sub2api_status: string;
  is_admin_protected: boolean;
  risk_status: AdminRiskEvent['status'] | null;
  risk_event_id: number | null;
  request_count_1h: number;
  request_count_24h: number;
  unique_ip_count_1h: number;
  unique_ip_count_24h: number;
  risk_score: number;
  risk_band: 'normal' | 'observe' | 'block';
  rule_hits: AdminRiskRuleHit[];
  first_seen_at: string;
  last_seen_at: string;
}

export interface AdminMonitoringIpUsersResponse {
  ip: AdminMonitoringIpItem;
  items: AdminMonitoringIpUserItem[];
  total: number;
  generated_at: string;
}

export interface AdminMonitoringIpCloudflareStatus {
  ip_address: string;
  enabled: boolean;
  can_manage: boolean;
  disabled_reason: string;
  matched_rule_count: number;
  rule: {
    id: string;
    mode: 'block' | 'challenge' | 'managed_challenge' | 'js_challenge' | 'whitelist';
    source: 'managed' | 'external';
    notes: string;
    created_at: string | null;
    modified_at: string | null;
  } | null;
}

export interface AdminMonitoringUserItem {
  sub2api_user_id: number;
  sub2api_email: string;
  sub2api_username: string;
  linuxdo_subject: string | null;
  sub2api_role: 'admin' | 'user';
  sub2api_status: string;
  is_admin_protected: boolean;
  risk_status: AdminRiskEvent['status'] | null;
  risk_event_id: number | null;
  request_count_1h: number;
  request_count_24h: number;
  unique_ip_count_1h: number;
  unique_ip_count_24h: number;
  risk_score: number;
  risk_band: 'normal' | 'observe' | 'block';
  rule_hits: AdminRiskRuleHit[];
  first_seen_at: string;
  last_seen_at: string;
}

export interface AdminMonitoringUserList {
  items: AdminMonitoringUserItem[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  generated_at: string;
}

export interface AdminMonitoringUserIpItem {
  ip_address: string;
  request_count_1h: number;
  request_count_24h: number;
  shared_user_count_24h: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface AdminMonitoringUserIpsResponse {
  user: AdminMonitoringUserItem;
  items: AdminMonitoringUserIpItem[];
  total: number;
  generated_at: string;
}

export interface AdminMonitoringUserStatusResult {
  item: {
    id: number;
    email: string;
    username: string;
    role: 'admin' | 'user';
    status: string;
  };
}

export interface AdminMonitoringIpDetailResponse {
  ip: AdminMonitoringIpItem;
  items: AdminMonitoringIpUserItem[];
  total: number;
  cloudflare: AdminMonitoringIpCloudflareStatus;
  recent_actions: AdminMonitoringActionItem[];
  generated_at: string;
}

export interface AdminMonitoringUserDetailResponse {
  user: AdminMonitoringUserItem;
  items: AdminMonitoringUserIpItem[];
  total: number;
  open_risk_event: AdminRiskEvent | null;
  recent_actions: AdminMonitoringActionItem[];
  generated_at: string;
}

export interface AdminCheckinItem {
  id: number;
  sub2apiUserId: number;
  sub2apiEmail: string;
  sub2apiUsername: string;
  linuxdoSubject: string | null;
  checkinDate: string;
  checkinMode: CheckinMode;
  blindboxItemId: number | null;
  blindboxTitle: string | null;
  rewardBalance: number;
  idempotencyKey: string;
  grantStatus: 'pending' | 'success' | 'failed';
  grantError: string;
  sub2apiRequestId: string;
  createdAt: string;
}

export interface AdminCheckinList {
  items: AdminCheckinItem[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export type AdminCheckinRetryResult =
  | {
      item: AdminCheckinItem;
      new_balance: number | null;
      deleted: false;
      deleted_reason: null;
      detail_message: string | null;
    }
  | {
      item: null;
      new_balance: null;
      deleted: true;
      deleted_reason: string;
      detail_message: null;
    };

export interface AdminCheckinQuery {
  page?: number;
  page_size?: number;
  date_from?: string;
  date_to?: string;
  grant_status?: 'pending' | 'success' | 'failed';
  subject?: string;
}

export interface AdminRedeemCodeItem {
  id: number;
  code: string;
  title: string;
  rewardBalance: number;
  maxClaims: number;
  claimedCount: number;
  remainingClaims: number;
  enabled: boolean;
  expiresAt: string | null;
  isExpired: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBlindboxItem {
  id: number;
  title: string;
  reward_balance: number;
  weight: number;
  enabled: boolean;
  notes: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface AdminRedeemClaimItem {
  id: number;
  redeemCodeId: number;
  redeemCode: string;
  redeemTitle: string;
  sub2apiUserId: number;
  sub2apiEmail: string;
  sub2apiUsername: string;
  linuxdoSubject: string | null;
  rewardBalance: number;
  idempotencyKey: string;
  grantStatus: 'pending' | 'success' | 'failed';
  grantError: string;
  sub2apiRequestId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRedeemClaimList {
  items: AdminRedeemClaimItem[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export type AdminRedeemClaimRetryResult =
  | {
      item: AdminRedeemClaimItem;
      new_balance: number | null;
      deleted: false;
      deleted_reason: null;
      detail_message: string | null;
    }
  | {
      item: null;
      new_balance: null;
      deleted: true;
      deleted_reason: string;
      detail_message: null;
    };

export interface AdminRedeemClaimQuery {
  page?: number;
  page_size?: number;
  grant_status?: 'pending' | 'success' | 'failed';
  subject?: string;
  code?: string;
}

export interface AdminResetRecord {
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

export interface AdminResetRecordList {
  items: AdminResetRecord[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface AdminResetRecordQuery {
  page?: number;
  page_size?: number;
  date_from?: string;
  date_to?: string;
  grant_status?: 'pending' | 'success' | 'failed';
  subject?: string;
}

export interface AdminUserSearchItem {
  sub2api_user_id: number;
  email: string;
  username: string;
  linuxdo_subject: string | null;
}

export interface AdminCleanupCandidate {
  sub2api_user_id: number;
  email: string;
  username: string;
  balance: number | null;
  linuxdo_subject: string | null;
  welfare_activity: {
    checkin_count: number;
    redeem_count: number;
    reset_count: number;
  };
  cleanup_reason: string;
}

export interface AdminCleanupCandidateList {
  items: AdminCleanupCandidate[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface AdminCleanupDeleteItem {
  sub2api_user_id: number;
  email: string;
  username: string;
  deleted: boolean;
  detail: string;
}

export interface AdminCleanupDeleteResult {
  items: AdminCleanupDeleteItem[];
  total: number;
  success_count: number;
  fail_count: number;
}

export interface WhitelistItem {
  id: number;
  sub2apiUserId: number | null;
  email: string;
  username: string;
  linuxdoSubject: string | null;
  notes: string;
  createdAt: string;
}

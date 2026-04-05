import type {
  AdminBlindboxItem,
  AdminCleanupCandidateList,
  AdminCleanupDeleteResult,
  AdminCheckinItem,
  AdminCheckinList,
  AdminCheckinQuery,
  AdminCheckinRetryResult,
  AdminMonitoringActionList,
  AdminMonitoringActionType,
  AdminMonitoringIpCloudflareStatus,
  AdminMonitoringIpList,
  AdminMonitoringIpUsersResponse,
  AdminMonitoringOverview,
  AdminMonitoringUserIpsResponse,
  AdminMonitoringUserList,
  AdminMonitoringUserStatusResult,
  AdminOverview,
  AdminRiskEventList,
  AdminRiskEventQuery,
  AdminRiskObservationList,
  AdminRiskOverview,
  AdminRiskScanResult,
  AdminResetRecordList,
  AdminResetRecordQuery,
  AdminRedeemClaimItem,
  AdminRedeemClaimList,
  AdminRedeemClaimQuery,
  AdminRedeemClaimRetryResult,
  AdminRedeemCodeItem,
  AdminSettings,
  AdminUserSearchItem,
  ApiEnvelope,
  CheckinHistoryItem,
  CheckinStatus,
  DailyStats,
  ResetHistoryItem,
  ResetStatus,
  RedeemHistoryItem,
  SessionUser,
  WhitelistItem
} from '../types';
import { getStoredSessionToken } from './session-token';

const apiBase = import.meta.env.VITE_WELFARE_API_BASE?.replace(/\/+$/, '') || '';

export class ApiError extends Error {
  readonly status: number;
  readonly code: number;

  constructor(status: number, code: number, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isUnauthorizedError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401;
}

function shouldAttachJsonContentType(init: RequestInit, headers: Headers): boolean {
  if (headers.has('Content-Type')) {
    return false;
  }

  if (init.body == null) {
    return false;
  }

  return !(init.body instanceof FormData);
}

function resolveApiPath(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return apiBase ? `${apiBase}${normalizedPath}` : normalizedPath;
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  const sessionToken = getStoredSessionToken();

  if (sessionToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }

  if (shouldAttachJsonContentType(init, headers)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(resolveApiPath(path), {
    ...init,
    headers
  });

  const rawBody = await response.text();
  let body: ApiEnvelope<T> | null = null;

  if (rawBody) {
    try {
      body = JSON.parse(rawBody) as ApiEnvelope<T>;
    } catch {
      throw new ApiError(response.status, response.status, rawBody || '服务响应格式无效');
    }
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.code ?? response.status,
      body?.detail || body?.message || rawBody || '请求失败'
    );
  }

  if (!body) {
    throw new ApiError(response.status, response.status, '服务响应为空');
  }

  if (body.code !== 0) {
    throw new ApiError(
      response.status,
      body.code,
      body.detail || body.message || '请求失败'
    );
  }

  return body.data;
}

export const api = {
  exchangeSessionHandoff: (handoff: string) =>
    request<{
      session_token: string;
      redirect: string;
    }>('/api/auth/session-handoff/exchange', {
      method: 'POST',
      body: JSON.stringify({ handoff })
    }),
  exchangeSub2apiSession: (payload: {
    access_token: string;
    user_id?: number;
    redirect?: string;
  }) =>
    request<{
      session_token: string;
      redirect: string;
    }>('/api/auth/sub2api/exchange', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  getMe: (sessionToken?: string) =>
    request<SessionUser>('/api/auth/me', {
      headers: sessionToken
        ? {
            Authorization: `Bearer ${sessionToken}`
          }
        : undefined
    }),
  logout: () => request<{ message: string }>('/api/auth/logout', { method: 'POST' }),
  getCheckinStatus: () => request<CheckinStatus>('/api/checkin/status'),
  checkin: () =>
    request<{
      checkin_date: string;
      checkin_mode: 'normal';
      blindbox_item_id: null;
      blindbox_title: null;
      reward_balance: number;
      new_balance: number | null;
      grant_status: 'success';
    }>('/api/checkin', { method: 'POST' }),
  checkBlindbox: () =>
    request<{
      checkin_date: string;
      checkin_mode: 'blindbox';
      blindbox_item_id: number | null;
      blindbox_title: string | null;
      reward_balance: number;
      new_balance: number | null;
      grant_status: 'success';
    }>('/api/checkin/blindbox', { method: 'POST' }),
  getCheckinHistory: () => request<CheckinHistoryItem[]>('/api/checkin/history'),
  getResetStatus: () => request<ResetStatus>('/api/reset/status'),
  applyReset: () =>
    request<{
      id: number;
      before_balance: number;
      granted_balance: number;
      new_balance: number;
      target_balance: number;
      next_available_at: string | null;
      grant_status: 'success';
    }>('/api/reset/apply', {
      method: 'POST'
    }),
  getResetHistory: () => request<ResetHistoryItem[]>('/api/reset/history'),
  redeemCode: (payload: { code: string }) =>
    request<{
      claim_id: number;
      code: string;
      title: string;
      reward_balance: number;
      new_balance: number | null;
      grant_status: 'success';
    }>('/api/redeem-codes/redeem', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  getRedeemHistory: () => request<RedeemHistoryItem[]>('/api/redeem-codes/history'),
  getAdminOverview: () => request<AdminOverview>('/api/admin/overview'),
  getAdminRiskOverview: () => request<AdminRiskOverview>('/api/admin/risk-events/overview'),
  getAdminMonitoringOverview: () => request<AdminMonitoringOverview>('/api/admin/monitoring/overview'),
  getAdminSettings: () => request<AdminSettings>('/api/admin/settings'),
  updateAdminSettings: (payload: Partial<AdminSettings>) =>
    request<AdminSettings>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  getDailyStats: (days: number) => request<DailyStats>(`/api/admin/stats/daily?days=${days}`),
  listAdminCheckins: (params: AdminCheckinQuery = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.page_size) query.set('page_size', String(params.page_size));
    if (params.date_from) query.set('date_from', params.date_from);
    if (params.date_to) query.set('date_to', params.date_to);
    if (params.grant_status) query.set('grant_status', params.grant_status);
    if (params.subject) query.set('subject', params.subject);
    const suffix = query.toString();
    return request<AdminCheckinList>(
      `/api/admin/checkins${suffix ? `?${suffix}` : ''}`
    );
  },
  listAdminMonitoringIps: (params: {
    page?: number;
    page_size?: number;
    search?: string;
  } = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.page_size) query.set('page_size', String(params.page_size));
    if (params.search?.trim()) query.set('search', params.search.trim());
    const suffix = query.toString();
    return request<AdminMonitoringIpList>(
      `/api/admin/monitoring/ips${suffix ? `?${suffix}` : ''}`
    );
  },
  getAdminMonitoringIpUsers: (ipAddress: string) =>
    request<AdminMonitoringIpUsersResponse>(
      `/api/admin/monitoring/ips/${encodeURIComponent(ipAddress)}/users`
    ),
  getAdminMonitoringIpCloudflareStatus: (ipAddress: string) =>
    request<AdminMonitoringIpCloudflareStatus>(
      `/api/admin/monitoring/ips/${encodeURIComponent(ipAddress)}/cloudflare`
    ),
  challengeAdminMonitoringIp: (ipAddress: string, payload: { reason?: string } = {}) =>
    request<{ item: AdminMonitoringIpCloudflareStatus }>(
      `/api/admin/monitoring/ips/${encodeURIComponent(ipAddress)}/challenge`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    ),
  blockAdminMonitoringIp: (ipAddress: string, payload: { reason?: string } = {}) =>
    request<{ item: AdminMonitoringIpCloudflareStatus }>(
      `/api/admin/monitoring/ips/${encodeURIComponent(ipAddress)}/block`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    ),
  clearAdminMonitoringIpCloudflare: (ipAddress: string, payload: { reason?: string } = {}) =>
    request<{ item: AdminMonitoringIpCloudflareStatus }>(
      `/api/admin/monitoring/ips/${encodeURIComponent(ipAddress)}/cloudflare`,
      {
        method: 'DELETE',
        body: JSON.stringify(payload)
      }
    ),
  listAdminMonitoringUsers: (params: {
    page?: number;
    page_size?: number;
  } = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.page_size) query.set('page_size', String(params.page_size));
    const suffix = query.toString();
    return request<AdminMonitoringUserList>(
      `/api/admin/monitoring/users${suffix ? `?${suffix}` : ''}`
    );
  },
  getAdminMonitoringUserIps: (userId: number) =>
    request<AdminMonitoringUserIpsResponse>(`/api/admin/monitoring/users/${userId}/ips`),
  disableAdminMonitoringUser: (userId: number, payload: { reason?: string } = {}) =>
    request<AdminMonitoringUserStatusResult>(`/api/admin/monitoring/users/${userId}/disable`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  enableAdminMonitoringUser: (userId: number, payload: { reason?: string } = {}) =>
    request<AdminMonitoringUserStatusResult>(`/api/admin/monitoring/users/${userId}/enable`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  listAdminMonitoringActions: (params: {
    page?: number;
    page_size?: number;
    action_type?: AdminMonitoringActionType;
  } = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.page_size) query.set('page_size', String(params.page_size));
    if (params.action_type) query.set('action_type', params.action_type);
    const suffix = query.toString();
    return request<AdminMonitoringActionList>(
      `/api/admin/monitoring/actions${suffix ? `?${suffix}` : ''}`
    );
  },
  retryAdminCheckin: (id: number) =>
    request<AdminCheckinRetryResult>(`/api/admin/checkins/${id}/retry`, {
      method: 'POST'
    }),
  listWhitelist: () => request<WhitelistItem[]>('/api/admin/whitelist'),
  searchAdminSub2apiUsers: (query: string) =>
    request<AdminUserSearchItem[]>(
      `/api/admin/sub2api-users/search?q=${encodeURIComponent(query)}`
    ),
  listAdminCleanupCandidates: (params: {
    page?: number;
    page_size?: number;
    search?: string;
  } = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.page_size) query.set('page_size', String(params.page_size));
    if (params.search) query.set('search', params.search);
    const suffix = query.toString();
    return request<AdminCleanupCandidateList>(
      `/api/admin/user-cleanup/candidates${suffix ? `?${suffix}` : ''}`
    );
  },
  deleteAdminCleanupCandidates: (userIds: number[]) =>
    request<AdminCleanupDeleteResult>('/api/admin/user-cleanup/delete', {
      method: 'POST',
      body: JSON.stringify({
        user_ids: userIds
      })
    }),
  listAdminRiskEvents: (params: AdminRiskEventQuery = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.page_size) query.set('page_size', String(params.page_size));
    if (params.status) query.set('status', params.status);
    const suffix = query.toString();
    return request<AdminRiskEventList>(
      `/api/admin/risk-events${suffix ? `?${suffix}` : ''}`
    );
  },
  getAdminMonitoringRiskOverview: () =>
    request<AdminRiskOverview>('/api/admin/monitoring/risk-events/overview'),
  listAdminMonitoringRiskEvents: (params: AdminRiskEventQuery = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.page_size) query.set('page_size', String(params.page_size));
    if (params.status) query.set('status', params.status);
    const suffix = query.toString();
    return request<AdminRiskEventList>(
      `/api/admin/monitoring/risk-events${suffix ? `?${suffix}` : ''}`
    );
  },
  listAdminRiskObservations: (params: {
    page?: number;
    page_size?: number;
  } = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.page_size) query.set('page_size', String(params.page_size));
    const suffix = query.toString();
    return request<AdminRiskObservationList>(
      `/api/admin/risk-events/observations${suffix ? `?${suffix}` : ''}`
    );
  },
  listAdminMonitoringRiskObservations: (params: {
    page?: number;
    page_size?: number;
  } = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.page_size) query.set('page_size', String(params.page_size));
    const suffix = query.toString();
    return request<AdminRiskObservationList>(
      `/api/admin/monitoring/risk-events/observations${suffix ? `?${suffix}` : ''}`
    );
  },
  scanAdminRiskEvents: () =>
    request<AdminRiskScanResult>('/api/admin/risk-events/scan', {
      method: 'POST'
    }),
  scanAdminMonitoringRiskEvents: () =>
    request<AdminRiskScanResult>('/api/admin/monitoring/risk-events/scan', {
      method: 'POST'
    }),
  releaseAdminRiskEvent: (id: number, payload: { reason?: string } = {}) =>
    request<{ item: AdminRiskEventList['items'][number] }>(`/api/admin/risk-events/${id}/release`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  releaseAdminMonitoringRiskEvent: (id: number, payload: { reason?: string } = {}) =>
    request<{ item: AdminRiskEventList['items'][number] }>(`/api/admin/monitoring/risk-events/${id}/release`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  addWhitelist: (payload: {
    sub2api_user_id: number;
    email: string;
    username: string;
    linuxdo_subject?: string | null;
    notes?: string;
  }) =>
    request<WhitelistItem>('/api/admin/whitelist', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  removeWhitelist: (id: number) =>
    request<{ deleted: boolean }>(`/api/admin/whitelist/${id}`, {
      method: 'DELETE'
    }),
  listAdminBlindboxItems: () => request<AdminBlindboxItem[]>('/api/admin/blindbox/items'),
  createAdminBlindboxItem: (payload: {
    title: string;
    reward_balance: number;
    weight: number;
    enabled?: boolean;
    notes?: string;
    sort_order?: number;
  }) =>
    request<AdminBlindboxItem>('/api/admin/blindbox/items', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  updateAdminBlindboxItem: (
    id: number,
    payload: {
      title?: string;
      reward_balance?: number;
      weight?: number;
      enabled?: boolean;
      notes?: string;
      sort_order?: number;
    }
  ) =>
    request<AdminBlindboxItem>(`/api/admin/blindbox/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }),
  listAdminRedeemCodes: () => request<AdminRedeemCodeItem[]>('/api/admin/redeem-codes'),
  createAdminRedeemCode: (payload: {
    code: string;
    title: string;
    reward_balance: number;
    max_claims: number;
    enabled?: boolean;
    expires_at?: string | null;
    notes?: string;
  }) =>
    request<AdminRedeemCodeItem>('/api/admin/redeem-codes', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  updateAdminRedeemCode: (
    id: number,
    payload: {
      title?: string;
      enabled?: boolean;
      expires_at?: string | null;
      notes?: string;
    }
  ) =>
    request<AdminRedeemCodeItem>(`/api/admin/redeem-codes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }),
  listAdminRedeemClaims: (params: AdminRedeemClaimQuery = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.page_size) query.set('page_size', String(params.page_size));
    if (params.grant_status) query.set('grant_status', params.grant_status);
    if (params.subject) query.set('subject', params.subject);
    if (params.code) query.set('code', params.code);
    const suffix = query.toString();
    return request<AdminRedeemClaimList>(
      `/api/admin/redeem-claims${suffix ? `?${suffix}` : ''}`
    );
  },
  retryAdminRedeemClaim: (id: number) =>
    request<AdminRedeemClaimRetryResult>(`/api/admin/redeem-claims/${id}/retry`, {
      method: 'POST'
    }),
  listAdminResetRecords: (params: AdminResetRecordQuery = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.page_size) query.set('page_size', String(params.page_size));
    if (params.date_from) query.set('date_from', params.date_from);
    if (params.date_to) query.set('date_to', params.date_to);
    if (params.grant_status) query.set('grant_status', params.grant_status);
    if (params.subject) query.set('subject', params.subject);
    const suffix = query.toString();
    return request<AdminResetRecordList>(
      `/api/admin/reset-records${suffix ? `?${suffix}` : ''}`
    );
  }
};

export function buildLinuxDoStartUrl(redirectPath: string): string {
  const url = new URL(resolveApiPath('/api/auth/linuxdo/start'), window.location.origin);
  url.searchParams.set('redirect', redirectPath);
  return url.toString();
}

export function buildSub2apiAdminLoginUrl(redirectPath = '/admin'): string | null {
  const baseUrl = import.meta.env.VITE_SUB2API_ADMIN_LOGIN_URL?.trim();
  if (!baseUrl) {
    return null;
  }

  const url = new URL(baseUrl, window.location.origin);
  url.searchParams.set('redirect', redirectPath);
  return url.toString();
}

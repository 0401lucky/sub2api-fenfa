import type {
  AdminCheckinItem,
  AdminCheckinList,
  AdminCheckinQuery,
  AdminOverview,
  AdminRedeemClaimItem,
  AdminRedeemClaimList,
  AdminRedeemClaimQuery,
  AdminRedeemCodeItem,
  AdminSettings,
  ApiEnvelope,
  CheckinHistoryItem,
  CheckinStatus,
  DailyStats,
  RedeemHistoryItem,
  SessionUser,
  WhitelistItem
} from '../types';

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

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (shouldAttachJsonContentType(init, headers)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
    credentials: 'include'
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
  getMe: () => request<SessionUser>('/api/auth/me'),
  logout: () => request<{ message: string }>('/api/auth/logout', { method: 'POST' }),
  getCheckinStatus: () => request<CheckinStatus>('/api/checkin/status'),
  checkin: () =>
    request<{
      checkin_date: string;
      reward_balance: number;
      new_balance: number | null;
      grant_status: 'success';
    }>('/api/checkin', { method: 'POST' }),
  getCheckinHistory: () => request<CheckinHistoryItem[]>('/api/checkin/history'),
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
  retryAdminCheckin: (id: number) =>
    request<{
      item: AdminCheckinItem;
      new_balance: number | null;
    }>(`/api/admin/checkins/${id}/retry`, {
      method: 'POST'
    }),
  listWhitelist: () => request<WhitelistItem[]>('/api/admin/whitelist'),
  addWhitelist: (payload: { linuxdo_subject: string; notes?: string }) =>
    request<WhitelistItem>('/api/admin/whitelist', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  removeWhitelist: (id: number) =>
    request<{ deleted: boolean }>(`/api/admin/whitelist/${id}`, {
      method: 'DELETE'
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
    request<{
      item: AdminRedeemClaimItem;
      new_balance: number | null;
    }>(`/api/admin/redeem-claims/${id}/retry`, {
      method: 'POST'
    })
};

export function buildLinuxDoStartUrl(redirectPath: string): string {
  const url = new URL('/api/auth/linuxdo/start', apiBase || window.location.origin);
  url.searchParams.set('redirect', redirectPath);
  return url.toString();
}

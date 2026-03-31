import { config } from '../config.js';
import { fetchWithTimeout, HttpError } from '../utils/http.js';

interface Sub2apiEnvelope<T> {
  code: number;
  message: string;
  reason?: string;
  data?: T;
}

interface PaginatedItems<T> {
  items: T[];
  total: number;
  page?: number;
  page_size?: number;
  pages?: number;
}

export interface AdminUserLite {
  id: number;
  email: string;
  username?: string;
  balance?: number;
  role?: 'admin' | 'user';
  status?: 'active' | 'disabled';
}

export type AdminUserRecord = AdminUserLite;

interface AdminUsersPage {
  items: AdminUserLite[];
  total: number;
}

export interface AdminUsageLog {
  id: number;
  userId: number;
  ipAddress: string | null;
  createdAt: string;
  user: AdminUserLite | null;
}

export type AdminUsageLogRecord = AdminUsageLog;

export interface AdminBalanceHistoryItem {
  id: number;
  code: string;
  type: string;
  value: number;
  status: string;
  notes: string;
  createdAt: string;
  usedBy: number | null;
  usedAt: string | null;
}

interface CurrentUserProfile {
  id: number;
  email: string;
  username: string;
}

const USER_PAGE_SIZE = 100;
const SUB2API_RETRY_DELAYS_MS = [0, 300];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class Sub2apiResponseError extends Error {
  readonly body: string;

  constructor(message: string, body = '') {
    super(message);
    this.name = 'Sub2apiResponseError';
    this.body = body;
  }
}

function isRetriableSub2apiError(error: unknown): boolean {
  if (error instanceof HttpError) {
    return [408, 425, 429, 500, 502, 503, 504].includes(error.status);
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    /fetch failed|network|timeout/i.test(error.message)
  );
}

export class Sub2apiClient {
  private readonly baseHeaders = {
    'Content-Type': 'application/json',
    'x-api-key': config.SUB2API_ADMIN_API_KEY
  } as const;

  private parseAdminUserLite(input: unknown): AdminUserLite {
    if (!input || typeof input !== 'object') {
      throw new Sub2apiResponseError('sub2api 用户信息格式非法');
    }

    const record = input as Record<string, unknown>;
    const rawRole = typeof record.role === 'string' ? record.role.trim().toLowerCase() : '';
    const rawStatus =
      typeof record.status === 'string' ? record.status.trim().toLowerCase() : '';
    return {
      id: Number(record.id),
      email: String(record.email ?? ''),
      username:
        typeof record.username === 'string' && record.username.trim() !== ''
          ? record.username
          : undefined,
      balance:
        typeof record.balance === 'number'
          ? record.balance
          : typeof record.balance === 'string'
            ? Number(record.balance)
            : undefined,
      role: rawRole === 'admin' || rawRole === 'user' ? rawRole : undefined,
      status:
        rawStatus === 'active' || rawStatus === 'disabled'
          ? rawStatus
          : undefined
    };
  }

  private parseAdminUsageLog(input: unknown): AdminUsageLog {
    if (!input || typeof input !== 'object') {
      throw new Sub2apiResponseError('sub2api usage 记录格式非法');
    }

    const record = input as Record<string, unknown>;
    const rawIpAddress =
      typeof record.ip_address === 'string'
        ? record.ip_address.trim()
        : null;

    return {
      id: Number(record.id),
      userId: Number(record.user_id),
      ipAddress: rawIpAddress ? rawIpAddress : null,
      createdAt: String(record.created_at ?? ''),
      user:
        record.user && typeof record.user === 'object'
          ? this.parseAdminUserLite(record.user)
          : null
    };
  }

  private parseEnvelope<T>(body: string, context: string): Sub2apiEnvelope<T> {
    try {
      return JSON.parse(body) as Sub2apiEnvelope<T>;
    } catch {
      throw new Sub2apiResponseError(`${context}：sub2api 返回了无法解析的响应`, body);
    }
  }

  private parseAdminBalanceHistoryItem(input: unknown): AdminBalanceHistoryItem {
    if (!input || typeof input !== 'object') {
      throw new Sub2apiResponseError('sub2api 余额流水格式非法');
    }

    const record = input as Record<string, unknown>;
    return {
      id: Number(record.id),
      code: String(record.code ?? ''),
      type: String(record.type ?? ''),
      value:
        typeof record.value === 'number'
          ? record.value
          : typeof record.value === 'string'
            ? Number(record.value)
            : 0,
      status: String(record.status ?? ''),
      notes: String(record.notes ?? ''),
      createdAt: String(record.created_at ?? ''),
      usedBy:
        typeof record.used_by === 'number'
          ? record.used_by
          : typeof record.used_by === 'string' && record.used_by.trim() !== ''
            ? Number(record.used_by)
            : null,
      usedAt:
        typeof record.used_at === 'string' && record.used_at.trim() !== ''
          ? record.used_at
          : null
    };
  }

  private async withRetries<T>(
    context: string,
    task: () => Promise<T>
  ): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await task();
      } catch (error) {
        if (
          !isRetriableSub2apiError(error) ||
          attempt >= SUB2API_RETRY_DELAYS_MS.length
        ) {
          throw error;
        }

        const delayMs = SUB2API_RETRY_DELAYS_MS[attempt] ?? 0;
        console.warn(
          `[sub2api] ${context} 第 ${attempt + 1} 次失败，${delayMs}ms 后重试`,
          error instanceof Error ? error.message : error
        );
        attempt += 1;
        await sleep(delayMs);
      }
    }
  }

  private async fetchUsersPage(
    search: string,
    page: number,
    pageSize = USER_PAGE_SIZE
  ): Promise<Sub2apiEnvelope<AdminUsersPage>> {
    return this.withRetries(`查询用户 ${search}`, async () => {
      const query = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize)
      });
      if (search.trim() !== '') {
        query.set('search', search);
      }

      const response = await fetchWithTimeout(
        `${config.SUB2API_BASE_URL}/api/v1/admin/users?${query.toString()}`,
        {
          method: 'GET',
          headers: this.baseHeaders
        },
        config.SUB2API_TIMEOUT_MS
      );
      const body = await response.text();
      if (!response.ok) {
        throw new HttpError(response.status, body, `查询 sub2api 用户失败: ${response.status}`);
      }

      const envelope = this.parseEnvelope<AdminUsersPage>(body, '查询 sub2api 用户失败');
      if (envelope.code !== 0 || !envelope.data) {
        throw new Sub2apiResponseError(
          `查询 sub2api 用户失败：${envelope.message || 'unknown error'}`,
          body
        );
      }

      return envelope;
    });
  }

  async findUserByEmail(email: string): Promise<AdminUserLite | null> {
    const normalized = email.toLowerCase();
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const envelope = await this.fetchUsersPage(email, page);
      const items = envelope.data?.items ?? [];
      const matched =
        items.find((item) => item.email?.toLowerCase() === normalized) ?? null;
      if (matched) {
        return this.parseAdminUserLite(matched);
      }

      const total = envelope.data?.total ?? items.length;
      totalPages = Math.max(1, Math.ceil(total / USER_PAGE_SIZE));
      if (items.length === 0) {
        break;
      }
      page += 1;
    }

    return null;
  }

  async findUserBySyntheticEmail(email: string): Promise<AdminUserLite | null> {
    return this.findUserByEmail(email);
  }

  async getAdminUserById(userId: number): Promise<AdminUserLite | null> {
    return this.withRetries(`查询用户 #${userId}`, async () => {
      const response = await fetchWithTimeout(
        `${config.SUB2API_BASE_URL}/api/v1/admin/users/${userId}`,
        {
          method: 'GET',
          headers: this.baseHeaders
        },
        config.SUB2API_TIMEOUT_MS
      );
      const body = await response.text();
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new HttpError(response.status, body, `查询 sub2api 用户失败: ${response.status}`);
      }

      const envelope = this.parseEnvelope<AdminUserLite>(body, '查询 sub2api 用户失败');
      if (envelope.code !== 0 || !envelope.data) {
        throw new Sub2apiResponseError(
          `查询 sub2api 用户失败：${envelope.message || 'unknown error'}`,
          body
        );
      }

      return this.parseAdminUserLite(envelope.data);
    });
  }

  async searchAdminUsers(query: string, pageSize = 20): Promise<AdminUserLite[]> {
    const normalized = query.trim();
    if (!normalized) {
      return [];
    }

    const envelope = await this.fetchUsersPage(normalized, 1, pageSize);
    const items = envelope.data?.items ?? [];
    return items.map((item) => this.parseAdminUserLite(item));
  }

  async listAdminUsers(
    page = 1,
    pageSize = USER_PAGE_SIZE,
    search = ''
  ): Promise<{ items: AdminUserLite[]; total: number }> {
    const envelope = await this.fetchUsersPage(search.trim(), page, pageSize);
    return {
      items: (envelope.data?.items ?? []).map((item) => this.parseAdminUserLite(item)),
      total: envelope.data?.total ?? 0
    };
  }

  async listAllAdminUsers(search = ''): Promise<AdminUserLite[]> {
    let page = 1;
    let totalPages = 1;
    const items: AdminUserLite[] = [];

    while (page <= totalPages) {
      const result = await this.listAdminUsers(page, USER_PAGE_SIZE, search);
      items.push(...result.items);
      totalPages = Math.max(1, Math.ceil((result.total || result.items.length) / USER_PAGE_SIZE));
      if (result.items.length === 0) {
        break;
      }
      page += 1;
    }

    return items;
  }

  async getCurrentUser(accessToken: string): Promise<CurrentUserProfile> {
    return this.withRetries('获取当前 sub2api 登录用户', async () => {
      const response = await fetchWithTimeout(
        `${config.SUB2API_BASE_URL}/api/v1/auth/me`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        },
        config.SUB2API_TIMEOUT_MS
      );
      const body = await response.text();
      if (!response.ok) {
        throw new HttpError(response.status, body, `读取 sub2api 当前用户失败: ${response.status}`);
      }

      const envelope = this.parseEnvelope<CurrentUserProfile>(
        body,
        '读取 sub2api 当前用户失败'
      );
      if (envelope.code !== 0 || !envelope.data) {
        throw new Sub2apiResponseError(
          `读取 sub2api 当前用户失败：${envelope.message || 'unknown error'}`,
          body
        );
      }

      const record = envelope.data as unknown as Record<string, unknown>;
      if (
        typeof record.id !== 'number' ||
        typeof record.email !== 'string' ||
        typeof record.username !== 'string'
      ) {
        throw new Sub2apiResponseError('读取 sub2api 当前用户失败：返回字段不完整', body);
      }

      return {
        id: record.id,
        email: record.email,
        username: record.username
      };
    });
  }

  async addUserBalance(input: {
    userId: number;
    amount: number;
    notes: string;
    idempotencyKey: string;
  }): Promise<{ newBalance?: number; requestId: string }> {
    return this.withRetries(`给用户 ${input.userId} 发放兑换额度`, async () => {
      const response = await fetchWithTimeout(
        `${config.SUB2API_BASE_URL}/api/v1/admin/users/${input.userId}/balance`,
        {
          method: 'POST',
          headers: {
            ...this.baseHeaders,
            'Idempotency-Key': input.idempotencyKey
          },
          body: JSON.stringify({
            balance: input.amount,
            operation: 'add',
            notes: input.notes
          })
        },
        config.SUB2API_TIMEOUT_MS
      );
      const body = await response.text();
      const requestId = response.headers.get('x-request-id') ?? '';
      if (!response.ok) {
        throw new HttpError(response.status, body, `sub2api 加余额失败: ${response.status}`);
      }

      const envelope = this.parseEnvelope<AdminUserLite>(body, 'sub2api 加余额失败');
      if (envelope.code !== 0) {
        throw new Sub2apiResponseError(
          `sub2api 加余额失败：${envelope.message || 'unknown error'}`,
          body
        );
      }

      return {
        newBalance: envelope.data?.balance,
        requestId
      };
    });
  }

  async listAdminUserBalanceHistory(params: {
    userId: number;
    page?: number;
    pageSize?: number;
    type?: string;
  }): Promise<{
    items: AdminBalanceHistoryItem[];
    total: number;
    page: number;
    pageSize: number;
    pages: number;
  }> {
    return this.withRetries(`查询用户 #${params.userId} 余额流水`, async () => {
      const query = new URLSearchParams({
        page: String(params.page ?? 1),
        page_size: String(params.pageSize ?? USER_PAGE_SIZE)
      });
      if (params.type?.trim()) {
        query.set('type', params.type.trim());
      }

      const response = await fetchWithTimeout(
        `${config.SUB2API_BASE_URL}/api/v1/admin/users/${params.userId}/balance-history?${query.toString()}`,
        {
          method: 'GET',
          headers: this.baseHeaders
        },
        config.SUB2API_TIMEOUT_MS
      );
      const body = await response.text();
      if (!response.ok) {
        throw new HttpError(
          response.status,
          body,
          `查询 sub2api 余额流水失败: ${response.status}`
        );
      }

      const envelope = this.parseEnvelope<PaginatedItems<unknown>>(body, '查询 sub2api 余额流水失败');
      if (envelope.code !== 0 || !envelope.data) {
        throw new Sub2apiResponseError(
          `查询 sub2api 余额流水失败：${envelope.message || 'unknown error'}`,
          body
        );
      }

      const items = Array.isArray(envelope.data.items) ? envelope.data.items : [];
      const page = Number(envelope.data.page ?? params.page ?? 1);
      const pageSize = Number(envelope.data.page_size ?? params.pageSize ?? USER_PAGE_SIZE);
      const total = Number(envelope.data.total ?? items.length);
      const pages = Number(
        envelope.data.pages ?? Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
      );

      return {
        items: items.map((item) => this.parseAdminBalanceHistoryItem(item)),
        total,
        page,
        pageSize,
        pages
      };
    });
  }

  async deleteAdminUser(userId: number): Promise<{ message: string }> {
    return this.withRetries(`删除用户 ${userId}`, async () => {
      const response = await fetchWithTimeout(
        `${config.SUB2API_BASE_URL}/api/v1/admin/users/${userId}`,
        {
          method: 'DELETE',
          headers: this.baseHeaders
        },
        config.SUB2API_TIMEOUT_MS
      );
      const body = await response.text();
      if (!response.ok) {
        throw new HttpError(response.status, body, `删除 sub2api 用户失败: ${response.status}`);
      }

      const envelope = this.parseEnvelope<{ message?: string }>(
        body,
        '删除 sub2api 用户失败'
      );
      if (envelope.code !== 0) {
        throw new Sub2apiResponseError(
          `删除 sub2api 用户失败：${envelope.message || 'unknown error'}`,
          body
        );
      }

      return {
        message: envelope.data?.message || envelope.message || '用户已删除'
      };
    });
  }

  async listAdminUsageLogs(params: {
    page?: number;
    pageSize?: number;
    userId?: number;
    startDate?: string;
    endDate?: string;
    timezone?: string;
    exactTotal?: boolean;
  }): Promise<{
    items: AdminUsageLog[];
    total: number;
    page: number;
    pageSize: number;
    pages: number;
  }> {
    return this.withRetries('查询 sub2api usage 记录', async () => {
      const query = new URLSearchParams({
        page: String(params.page ?? 1),
        page_size: String(params.pageSize ?? USER_PAGE_SIZE)
      });
      if (params.userId) {
        query.set('user_id', String(params.userId));
      }
      if (params.startDate) {
        query.set('start_date', params.startDate);
      }
      if (params.endDate) {
        query.set('end_date', params.endDate);
      }
      if (params.timezone) {
        query.set('timezone', params.timezone);
      }
      if (params.exactTotal != null) {
        query.set('exact_total', String(params.exactTotal));
      }

      const response = await fetchWithTimeout(
        `${config.SUB2API_BASE_URL}/api/v1/admin/usage?${query.toString()}`,
        {
          method: 'GET',
          headers: this.baseHeaders
        },
        config.SUB2API_TIMEOUT_MS
      );
      const body = await response.text();
      if (!response.ok) {
        throw new HttpError(response.status, body, `查询 sub2api usage 失败: ${response.status}`);
      }

      const envelope = this.parseEnvelope<PaginatedItems<unknown>>(body, '查询 sub2api usage 失败');
      if (envelope.code !== 0 || !envelope.data) {
        throw new Sub2apiResponseError(
          `查询 sub2api usage 失败：${envelope.message || 'unknown error'}`,
          body
        );
      }

      const items = Array.isArray(envelope.data.items) ? envelope.data.items : [];
      const page = Number(envelope.data.page ?? params.page ?? 1);
      const pageSize = Number(envelope.data.page_size ?? params.pageSize ?? USER_PAGE_SIZE);
      const total = Number(envelope.data.total ?? items.length);
      const pages = Number(
        envelope.data.pages ?? Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
      );

      return {
        items: items.map((item) => this.parseAdminUsageLog(item)),
        total,
        page,
        pageSize,
        pages
      };
    });
  }

  async updateAdminUserStatus(
    userId: number,
    status: 'active' | 'disabled'
  ): Promise<AdminUserLite> {
    return this.withRetries(`更新用户 #${userId} 状态`, async () => {
      const response = await fetchWithTimeout(
        `${config.SUB2API_BASE_URL}/api/v1/admin/users/${userId}`,
        {
          method: 'PUT',
          headers: this.baseHeaders,
          body: JSON.stringify({
            status
          })
        },
        config.SUB2API_TIMEOUT_MS
      );
      const body = await response.text();
      if (!response.ok) {
        throw new HttpError(
          response.status,
          body,
          `更新 sub2api 用户状态失败: ${response.status}`
        );
      }

      const envelope = this.parseEnvelope<AdminUserLite>(body, '更新 sub2api 用户状态失败');
      if (envelope.code !== 0 || !envelope.data) {
        throw new Sub2apiResponseError(
          `更新 sub2api 用户状态失败：${envelope.message || 'unknown error'}`,
          body
        );
      }

      return this.parseAdminUserLite(envelope.data);
    });
  }
}

export const sub2apiClient = new Sub2apiClient();

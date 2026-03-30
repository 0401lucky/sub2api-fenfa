import { config } from '../config.js';
import { fetchWithTimeout, HttpError } from '../utils/http.js';

interface Sub2apiEnvelope<T> {
  code: number;
  message: string;
  reason?: string;
  data?: T;
}

interface AdminUserLite {
  id: number;
  email: string;
  username?: string;
  balance?: number;
}

interface AdminUsersPage {
  items: AdminUserLite[];
  total: number;
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
            : undefined
    };
  }

  private parseEnvelope<T>(body: string, context: string): Sub2apiEnvelope<T> {
    try {
      return JSON.parse(body) as Sub2apiEnvelope<T>;
    } catch {
      throw new Sub2apiResponseError(`${context}：sub2api 返回了无法解析的响应`, body);
    }
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
}

export const sub2apiClient = new Sub2apiClient();

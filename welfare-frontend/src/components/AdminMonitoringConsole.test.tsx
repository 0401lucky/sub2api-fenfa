import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminMonitoringConsole } from './AdminMonitoringConsole';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve,
    reject
  };
}

const { mockApi, mockIsUnauthorizedError } = vi.hoisted(() => ({
  mockApi: {
    getAdminMonitoringOverview: vi.fn(),
    listAdminMonitoringIps: vi.fn(),
    getAdminMonitoringIpUsers: vi.fn(),
    getAdminMonitoringIpCloudflareStatus: vi.fn(),
    listAdminMonitoringUsers: vi.fn(),
    getAdminMonitoringUserIps: vi.fn(),
    listAdminMonitoringActions: vi.fn(),
    getAdminMonitoringRiskOverview: vi.fn(),
    listAdminMonitoringRiskObservations: vi.fn(),
    listAdminMonitoringRiskEvents: vi.fn(),
    scanAdminMonitoringRiskEvents: vi.fn(),
    disableAdminMonitoringUser: vi.fn(),
    enableAdminMonitoringUser: vi.fn(),
    challengeAdminMonitoringIp: vi.fn(),
    blockAdminMonitoringIp: vi.fn(),
    clearAdminMonitoringIpCloudflare: vi.fn(),
    releaseAdminMonitoringRiskEvent: vi.fn()
  },
  mockIsUnauthorizedError: vi.fn()
}));

vi.mock('../lib/api', () => ({
  api: mockApi,
  isUnauthorizedError: mockIsUnauthorizedError
}));

function buildOverview() {
  return {
    generated_at: '2026-04-05T22:28:00.000Z',
    thresholds: {
      observe_ip_count: 4,
      block_ip_count: 6,
      lock_duration_ms: 86_400_000,
      live_cache_ttl_ms: 30_000,
      snapshot_interval_ms: 3_600_000
    },
    summary: {
      request_count_24h: 9128,
      active_user_count_24h: 1,
      unique_ip_count_24h: 93,
      observe_user_count_1h: 0,
      blocked_user_count: 0,
      pending_release_count: 0,
      shared_ip_count_1h: 4,
      shared_ip_count_24h: 9
    },
    windows: {
      observe_user_count_1h: 0,
      observe_user_count_24h: 0,
      shared_user_count_24h: 1,
      shared_ip_count_1h: 4,
      shared_ip_count_24h: 9
    },
    last_scan: {
      last_started_at: null,
      last_finished_at: null,
      last_status: 'success' as const,
      last_error: '',
      last_trigger_source: 'scheduled',
      scanned_user_count: 0,
      hit_user_count: 0,
      updated_at: '2026-04-05T22:28:00.000Z'
    },
    snapshot_points: [],
    recent_actions: []
  };
}

function buildRiskOverview() {
  return {
    active_event_count: 0,
    pending_release_count: 0,
    open_event_count: 0,
    observe_count_1h: 0,
    windows: {
      window_1h_observe_count: 0,
      window_3h_observe_count: 0,
      window_6h_observe_count: 0,
      window_24h_observe_count: 0
    },
    last_scan: {
      last_started_at: null,
      last_finished_at: null,
      last_status: 'success' as const,
      last_error: '',
      last_trigger_source: 'scheduled',
      scanned_user_count: 0,
      hit_user_count: 0,
      updated_at: '2026-04-05T22:28:00.000Z'
    }
  };
}

function buildIpList(search = '') {
  return {
    items: [
      {
        ip_address: '152.53.88.113',
        request_count_1h: 519,
        request_count_24h: 1975,
        user_count_1h: 1,
        user_count_24h: 1,
        first_seen_at: '2026-04-05T21:00:00.000Z',
        last_seen_at: '2026-04-05T22:15:00.000Z',
        risk_level: 'normal' as const,
        sample_users: []
      }
    ],
    total: 1,
    page: 1,
    page_size: 6,
    pages: 1,
    generated_at: '2026-04-05T22:28:00.000Z',
    search
  };
}

function buildIpUsers() {
  return {
    ip: buildIpList().items[0],
    items: [
      {
        sub2api_user_id: 7,
        sub2api_email: 'selected-user@example.com',
        sub2api_username: 'selected-user',
        linuxdo_subject: null,
        sub2api_role: 'user' as const,
        sub2api_status: 'active',
        is_admin_protected: false,
        risk_status: null,
        risk_event_id: null,
        request_count_1h: 519,
        request_count_24h: 1975,
        unique_ip_count_1h: 1,
        unique_ip_count_24h: 1,
        first_seen_at: '2026-04-05T21:00:00.000Z',
        last_seen_at: '2026-04-05T22:15:00.000Z'
      }
    ],
    total: 1,
    generated_at: '2026-04-05T22:28:00.000Z'
  };
}

function buildUserList() {
  return {
    items: [],
    total: 0,
    page: 1,
    page_size: 6,
    pages: 1,
    generated_at: '2026-04-05T22:28:00.000Z'
  };
}

function renderConsole() {
  return render(
    <AdminMonitoringConsole
      onUnauthorized={vi.fn().mockResolvedValue(undefined)}
      onError={vi.fn()}
      onSuccess={vi.fn()}
    />
  );
}

describe('AdminMonitoringConsole', () => {
  beforeEach(() => {
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    mockIsUnauthorizedError.mockReset();
    mockIsUnauthorizedError.mockReturnValue(false);

    mockApi.getAdminMonitoringOverview.mockResolvedValue(buildOverview());
    mockApi.listAdminMonitoringIps.mockImplementation(async (params?: { search?: string }) =>
      buildIpList(params?.search?.trim() ?? '')
    );
    mockApi.getAdminMonitoringIpUsers.mockResolvedValue(buildIpUsers());
    mockApi.getAdminMonitoringIpCloudflareStatus.mockResolvedValue({
      ip_address: '152.53.88.113',
      enabled: false,
      can_manage: false,
      disabled_reason: '未配置 Cloudflare',
      matched_rule_count: 0,
      rule: null
    });
    mockApi.listAdminMonitoringUsers.mockResolvedValue(buildUserList());
    mockApi.listAdminMonitoringActions.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 8,
      pages: 1
    });
    mockApi.getAdminMonitoringRiskOverview.mockResolvedValue(buildRiskOverview());
    mockApi.listAdminMonitoringRiskObservations.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 8,
      pages: 1
    });
    mockApi.listAdminMonitoringRiskEvents.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 6,
      pages: 1
    });
  });

  it('可以按 IP 关键字搜索榜单', async () => {
    renderConsole();

    await screen.findAllByText('152.53.88.113');

    fireEvent.change(screen.getByLabelText('搜索 IP'), {
      target: { value: '152.53' }
    });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    await screen.findByText(/当前搜索：/);
    await waitFor(() =>
      expect(mockApi.listAdminMonitoringIps).toHaveBeenLastCalledWith({
        page: 1,
        page_size: 6,
        search: '152.53'
      })
    );
  });

  it('Cloudflare 状态较慢时会先显示 IP 用户明细', async () => {
    const deferredCloudflare = createDeferred<Awaited<ReturnType<typeof mockApi.getAdminMonitoringIpCloudflareStatus>>>();
    mockApi.getAdminMonitoringIpCloudflareStatus.mockReturnValue(deferredCloudflare.promise);

    renderConsole();

    expect(await screen.findByText('selected-user')).toBeInTheDocument();
    expect(screen.getByText('正在读取 Cloudflare 规则状态...')).toBeInTheDocument();

    deferredCloudflare.resolve({
      ip_address: '152.53.88.113',
      enabled: false,
      can_manage: false,
      disabled_reason: '未配置 Cloudflare',
      matched_rule_count: 0,
      rule: null
    });

    await waitFor(() =>
      expect(screen.queryByText('正在读取 Cloudflare 规则状态...')).not.toBeInTheDocument()
    );
  });
});

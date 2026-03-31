import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminDistributionDetectionPanel } from './AdminDistributionDetectionPanel';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getAdminRiskOverview: vi.fn(),
    listAdminRiskObservations: vi.fn(),
    listAdminRiskEvents: vi.fn(),
    scanAdminRiskEvents: vi.fn(),
    releaseAdminRiskEvent: vi.fn()
  }
}));

vi.mock('../lib/api', () => ({
  api: mockApi,
  isUnauthorizedError: () => false
}));

describe('AdminDistributionDetectionPanel', () => {
  const onOverviewChange = vi.fn();
  const onUnauthorized = vi.fn().mockResolvedValue(undefined);
  const onError = vi.fn();
  const onSuccess = vi.fn();

  beforeEach(() => {
    onOverviewChange.mockReset();
    onUnauthorized.mockReset();
    onError.mockReset();
    onSuccess.mockReset();
    Object.values(mockApi).forEach((fn) => fn.mockReset());

    mockApi.getAdminRiskOverview.mockResolvedValue({
      active_event_count: 1,
      pending_release_count: 1,
      open_event_count: 2,
      observe_count_1h: 1,
      windows: {
        window_1h_observe_count: 1,
        window_3h_observe_count: 2,
        window_6h_observe_count: 3,
        window_24h_observe_count: 4
      },
      last_scan: {
        last_started_at: '2026-03-31T00:00:00.000Z',
        last_finished_at: '2026-03-31T00:05:00.000Z',
        last_status: 'success',
        last_error: '',
        last_trigger_source: 'scheduled',
        updated_at: '2026-03-31T00:05:00.000Z'
      }
    });
    mockApi.listAdminRiskObservations.mockResolvedValue({
      items: [
        {
          sub2api_user_id: 8,
          sub2api_email: 'observe@example.com',
          sub2api_username: 'observe-user',
          linuxdo_subject: 'observe-user',
          sub2api_role: 'user',
          sub2api_status: 'active',
          window_1h_ip_count: 4,
          window_3h_ip_count: 5,
          window_6h_ip_count: 5,
          window_24h_ip_count: 5,
          ip_samples: ['9.9.9.1', '9.9.9.2'],
          first_hit_at: '2026-03-31T00:10:00.000Z',
          last_hit_at: '2026-03-31T00:40:00.000Z'
        }
      ],
      total: 1,
      page: 1,
      page_size: 20,
      pages: 1
    });
    mockApi.listAdminRiskEvents.mockResolvedValue({
      items: [
        {
          id: 1,
          sub2apiUserId: 42,
          sub2apiEmail: 'normal-user@example.com',
          sub2apiUsername: 'normal-user',
          linuxdoSubject: 'normal-user',
          sub2apiRole: 'user',
          sub2apiStatus: 'disabled',
          status: 'pending_release',
          windowStartedAt: '2026-03-31T00:00:00.000Z',
          windowEndedAt: '2026-03-31T01:00:00.000Z',
          distinctIpCount: 4,
          ipSamples: ['1.1.1.1', '2.2.2.2'],
          firstHitAt: '2026-03-31T00:10:00.000Z',
          lastHitAt: '2026-03-31T00:40:00.000Z',
          minimumLockUntil: '2026-04-01T00:40:00.000Z',
          mainSiteSyncStatus: 'success',
          mainSiteSyncError: '',
          lastScanStatus: 'success',
          lastScanError: '',
          lastScanSource: 'scheduled',
          lastScannedAt: '2026-03-31T00:45:00.000Z',
          releasedBySub2apiUserId: null,
          releasedByEmail: '',
          releasedByUsername: '',
          releaseReason: '',
          releasedAt: null,
          createdAt: '2026-03-31T00:45:00.000Z',
          updatedAt: '2026-03-31T00:45:00.000Z'
        }
      ],
      total: 1,
      page: 1,
      page_size: 10,
      pages: 1
    });
  });

  it('会加载总览和风险事件列表', async () => {
    render(
      <AdminDistributionDetectionPanel
        overview={null}
        onOverviewChange={onOverviewChange}
        onUnauthorized={onUnauthorized}
        onError={onError}
        onSuccess={onSuccess}
      />
    );

    expect(await screen.findByText('normal-user')).toBeInTheDocument();
    expect(screen.getByText('observe-user')).toBeInTheDocument();
    expect(screen.getByText('1.1.1.1')).toBeInTheDocument();
    expect(onOverviewChange).toHaveBeenCalled();
  });

  it('支持手动扫描和手动恢复', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApi.scanAdminRiskEvents.mockResolvedValue({
      scanned_log_count: 10,
      matched_user_count: 2,
      created_event_count: 1,
      refreshed_event_count: 1,
      skipped_admin_count: 0,
      retried_main_site_count: 0,
      last_scan: {
        last_started_at: '2026-03-31T00:00:00.000Z',
        last_finished_at: '2026-03-31T00:05:00.000Z',
        last_status: 'success',
        last_error: '',
        last_trigger_source: 'manual',
        updated_at: '2026-03-31T00:05:00.000Z'
      }
    });
    mockApi.releaseAdminRiskEvent.mockResolvedValue({
      item: {
        id: 1,
        status: 'released'
      }
    });

    render(
      <AdminDistributionDetectionPanel
        overview={null}
        onOverviewChange={onOverviewChange}
        onUnauthorized={onUnauthorized}
        onError={onError}
        onSuccess={onSuccess}
      />
    );

    fireEvent.change(await screen.findByPlaceholderText('可选，记录本次恢复原因'), {
      target: { value: '人工核验后恢复' }
    });
    fireEvent.click(screen.getByRole('button', { name: '立即扫描' }));

    await waitFor(() => {
      expect(mockApi.scanAdminRiskEvents).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '手动恢复' }));

    await waitFor(() => {
      expect(mockApi.releaseAdminRiskEvent).toHaveBeenCalledWith(1, {
        reason: '人工核验后恢复'
      });
    });
  });
});

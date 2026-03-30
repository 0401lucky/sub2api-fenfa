import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPage } from './AdminPage';

const { mockUseAuth, mockApi } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockApi: {
    getAdminOverview: vi.fn(),
    listAdminRedeemCodes: vi.fn(),
    listAdminCheckins: vi.fn(),
    listAdminRedeemClaims: vi.fn(),
    updateAdminSettings: vi.fn(),
    addWhitelist: vi.fn(),
    removeWhitelist: vi.fn(),
    retryAdminCheckin: vi.fn(),
    getDailyStats: vi.fn()
  }
}));

vi.mock('../lib/auth', () => ({
  useAuth: () => mockUseAuth()
}));

vi.mock('../lib/api', () => ({
  api: mockApi,
  isUnauthorizedError: () => false
}));

vi.mock('../components/AdminDashboardOverview', () => ({
  AdminDashboardOverview: ({ onOpenRedeemCodes }: { onOpenRedeemCodes: () => void }) => (
    <div>
      <div>总览模块</div>
      <button onClick={onOpenRedeemCodes}>前往兑换码</button>
    </div>
  )
}));

vi.mock('../components/AdminCheckinsPanel', () => ({
  AdminCheckinsPanel: () => <div>签到模块</div>
}));

vi.mock('../components/AdminBlindboxPanel', () => ({
  AdminBlindboxPanel: () => <div>盲盒模块</div>
}));

vi.mock('../components/AdminRedeemCodesPanel', () => ({
  AdminRedeemCodesPanel: () => <div>兑换码模块</div>
}));

vi.mock('../components/AdminResetRecordsPanel', () => ({
  AdminResetRecordsPanel: () => <div>重置模块</div>
}));

vi.mock('../components/AdminRedeemClaimsPanel', () => ({
  AdminRedeemClaimsPanel: () => <div>兑换记录模块</div>
}));

vi.mock('../components/AdminWhitelistPanel', () => ({
  AdminWhitelistPanel: () => <div>白名单模块</div>
}));

describe('AdminPage dashboard', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    Object.values(mockApi).forEach((fn) => fn.mockReset());

    mockUseAuth.mockReturnValue({
      user: {
        username: 'admin-user',
        avatar_url: null,
        sub2api_user_id: 7,
        linuxdo_subject: 'admin-subject',
        is_admin: true
      },
      logout: vi.fn()
    });

    mockApi.getAdminOverview.mockResolvedValue({
      settings: {
        checkin_enabled: true,
        blindbox_enabled: true,
        daily_reward_min_balance: 10,
        daily_reward_max_balance: 20,
        timezone: 'Asia/Shanghai',
        reset_enabled: true,
        reset_threshold_balance: 20,
        reset_target_balance: 200,
        reset_cooldown_days: 7,
        reset_notice: '余额低于阈值时可直接重置'
      },
      stats: {
        days: 30,
        active_users: 12,
        total_checkins: 20,
        total_grant_balance: 200,
        points: []
      },
      whitelist: []
    });
    mockApi.listAdminRedeemCodes.mockResolvedValue([]);
    mockApi.listAdminCheckins.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 10,
      pages: 1
    });
    mockApi.listAdminRedeemClaims.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 10,
      pages: 1
    });
  });

  it('默认显示总览分区', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('总览模块')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '运营总览' })).toBeInTheDocument();
  });

  it('可以从总览切换到兑换码分区', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminPage />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByText('前往兑换码'));
    expect(await screen.findByText('兑换码模块')).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckinPage } from './CheckinPage';

const { mockUseAuth, mockApi } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockApi: {
    getCheckinStatus: vi.fn(),
    getCheckinHistory: vi.fn(),
    getRedeemHistory: vi.fn(),
    checkin: vi.fn(),
    checkBlindbox: vi.fn(),
    redeemCode: vi.fn()
  }
}));

vi.mock('../lib/auth', () => ({
  useAuth: () => mockUseAuth()
}));

vi.mock('../lib/api', () => ({
  api: mockApi,
  isUnauthorizedError: () => false
}));

describe('CheckinPage', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    Object.values(mockApi).forEach((fn) => fn.mockReset());

    mockUseAuth.mockReturnValue({
      user: {
        sub2api_user_id: 7,
        email: 'linuxdo-subject@linuxdo-connect.invalid',
        linuxdo_subject: 'subject',
        username: 'tester',
        avatar_url: null,
        is_admin: true
      },
      logout: vi.fn()
    });

    mockApi.getCheckinStatus.mockResolvedValue({
      checkin_enabled: true,
      blindbox_enabled: true,
      timezone: 'Asia/Shanghai',
      checkin_date: '2026-03-25',
      daily_reward_min_balance: 10,
      daily_reward_max_balance: 20,
      checked_in: false,
      selected_mode: null,
      can_checkin_normal: true,
      can_checkin_blindbox: true,
      grant_status: null,
      checked_at: null,
      reward_balance: null,
      blindbox_preview: {
        item_count: 2,
        min_reward: 8,
        max_reward: 15,
        items: [
          { id: 1, title: '安稳签', reward_balance: 8 },
          { id: 2, title: '好运签', reward_balance: 15 }
        ]
      },
      blindbox_result: null
    });
    mockApi.getCheckinHistory.mockResolvedValue([
      {
        id: 1,
        checkin_date: '2026-03-24',
        checkin_mode: 'normal',
        blindbox_title: null,
        reward_balance: 10,
        grant_status: 'success',
        grant_error: '',
        created_at: '2026-03-24T12:00:00.000Z'
      }
    ]);
    mockApi.getRedeemHistory.mockResolvedValue([
      {
        id: 2,
        redeem_code_id: 3,
        redeem_code: 'WELCOME100',
        redeem_title: '欢迎礼包',
        reward_balance: 100,
        grant_status: 'success',
        grant_error: '',
        created_at: '2026-03-24T13:00:00.000Z'
      }
    ]);
  });

  it('会加载签到状态并展示拆页后的快捷入口', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CheckinPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/DAILY CHECK-IN/i)).toBeInTheDocument();
    expect(screen.getByText('惊喜签到')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '前往福利码页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看记录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开重置页' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /惊喜签到风险型盲盒/i }));
    expect(await screen.findByRole('button', { name: '管理员演示开盒' })).toBeInTheDocument();

    await waitFor(() => {
      expect(mockApi.getCheckinStatus).toHaveBeenCalledTimes(1);
      expect(mockApi.getCheckinHistory).not.toHaveBeenCalled();
      expect(mockApi.getRedeemHistory).not.toHaveBeenCalled();
    });
  });

  it('普通签到按钮可点击并触发请求', async () => {
    mockApi.checkin.mockResolvedValue({
      checkin_date: '2026-03-25',
      checkin_mode: 'normal',
      blindbox_item_id: null,
      blindbox_title: null,
      reward_balance: 10,
      new_balance: 20,
      grant_status: 'success'
    });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CheckinPage />
      </MemoryRouter>
    );

    const button = await screen.findByRole('button', { name: '普通签到' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockApi.checkin).toHaveBeenCalledTimes(1);
    });
  });

  it('盲盒签到按钮可点击并触发请求', async () => {
    mockApi.checkBlindbox.mockResolvedValue({
      checkin_date: '2026-03-25',
      checkin_mode: 'blindbox',
      blindbox_item_id: 2,
      blindbox_title: '好运签',
      reward_balance: 15,
      new_balance: 25,
      grant_status: 'success'
    });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CheckinPage />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('tab', { name: /惊喜签到风险型盲盒/i }));
    const button = await screen.findByRole('button', { name: '开启今日盲盒' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockApi.checkBlindbox).toHaveBeenCalledTimes(1);
    });
  });
});

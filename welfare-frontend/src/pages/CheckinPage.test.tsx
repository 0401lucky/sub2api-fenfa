import { render, screen, waitFor } from '@testing-library/react';
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
        linuxdo_subject: 'subject',
        synthetic_email: 'linuxdo-subject@linuxdo-connect.invalid',
        username: 'tester',
        avatar_url: null,
        is_admin: true
      },
      logout: vi.fn()
    });

    mockApi.getCheckinStatus.mockResolvedValue({
      checkin_enabled: true,
      timezone: 'Asia/Shanghai',
      checkin_date: '2026-03-25',
      daily_reward_balance: 10,
      checked_in: false,
      can_checkin: true,
      grant_status: null,
      checked_at: null,
      reward_balance: null
    });
    mockApi.getCheckinHistory.mockResolvedValue([
      {
        id: 1,
        checkin_date: '2026-03-24',
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

  it('会加载签到状态、签到记录和兑换记录', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CheckinPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/欢迎回来/i)).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('2026') && content.includes('3/24'))
    ).toBeInTheDocument();
    expect(screen.getByText('WELCOME100')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /后台管理/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(mockApi.getCheckinStatus).toHaveBeenCalledTimes(1);
      expect(mockApi.getCheckinHistory).toHaveBeenCalledTimes(1);
      expect(mockApi.getRedeemHistory).toHaveBeenCalledTimes(1);
    });
  });
});

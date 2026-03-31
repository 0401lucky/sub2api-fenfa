import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResetPage } from './ResetPage';

const { mockUseAuth, mockApi } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockApi: {
    getResetStatus: vi.fn(),
    getResetHistory: vi.fn(),
    applyReset: vi.fn()
  }
}));

vi.mock('../lib/auth', () => ({
  useAuth: () => mockUseAuth()
}));

vi.mock('../lib/api', () => ({
  api: mockApi,
  isUnauthorizedError: () => false
}));

describe('ResetPage', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    Object.values(mockApi).forEach((fn) => fn.mockReset());

    mockUseAuth.mockReturnValue({
      logout: vi.fn()
    });

    mockApi.getResetStatus.mockResolvedValue({
      reset_enabled: true,
      current_balance: 12,
      threshold_balance: 20,
      target_balance: 200,
      cooldown_days: 7,
      notice: '余额低于阈值时可直接补到目标值',
      can_apply: true,
      reason: '',
      next_available_at: null,
      latest_record: null
    });
    mockApi.getResetHistory.mockResolvedValue([
      {
        id: 1,
        before_balance: 10,
        threshold_balance: 20,
        target_balance: 200,
        granted_balance: 190,
        new_balance: 200,
        cooldown_days: 7,
        grant_status: 'success',
        grant_error: '',
        created_at: '2026-03-30T08:00:00.000Z',
        updated_at: '2026-03-30T08:00:01.000Z'
      }
    ]);
  });

  it('会加载状态与历史，并触发直接重置', async () => {
    mockApi.applyReset.mockResolvedValue({
      id: 2,
      before_balance: 12,
      granted_balance: 188,
      new_balance: 200,
      target_balance: 200,
      next_available_at: '2026-04-06T08:00:00.000Z',
      grant_status: 'success'
    });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ResetPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('额度探测与重置 (Quota Reset)')).toBeInTheDocument();
    expect(screen.getByText('检测余额')).toBeInTheDocument();
    expect(screen.getByText('12.00')).toBeInTheDocument();
    expect(screen.getByText(/\+188\.00/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '提交补差指令' }));

    await waitFor(() => {
      expect(mockApi.applyReset).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockApi.getResetStatus).toHaveBeenCalledTimes(2);
      expect(mockApi.getResetHistory).toHaveBeenCalledTimes(2);
    });
  });
});

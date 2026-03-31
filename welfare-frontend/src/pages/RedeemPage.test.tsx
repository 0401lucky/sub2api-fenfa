import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedeemPage } from './RedeemPage';

const { mockUseAuth, mockApi } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockApi: {
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

describe('RedeemPage', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockApi.redeemCode.mockReset();
    mockUseAuth.mockReturnValue({
      logout: vi.fn()
    });
  });

  it('输入福利码后会发起兑换请求', async () => {
    mockApi.redeemCode.mockResolvedValue({
      claim_id: 1,
      code: 'WELCOME100',
      title: '欢迎礼包',
      reward_balance: 100,
      new_balance: 220,
      grant_status: 'success'
    });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <RedeemPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByPlaceholderText('例如：WELCOME100'), {
      target: { value: 'WELCOME100' }
    });
    fireEvent.click(screen.getByRole('button', { name: '提交兑换' }));

    await waitFor(() => {
      expect(mockApi.redeemCode).toHaveBeenCalledWith({ code: 'WELCOME100' });
    });
    await waitFor(() => {
      expect(screen.getByPlaceholderText('例如：WELCOME100')).toHaveValue('');
    });
  });
});

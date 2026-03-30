import type { CheckinMode } from '../types';

export function getModeLabel(mode: CheckinMode): string {
  return mode === 'blindbox' ? '惊喜签到' : '普通签到';
}

export function formatRewardRange(minBalance: number, maxBalance: number): string {
  if (minBalance === maxBalance) {
    return minBalance.toFixed(2);
  }

  return `${minBalance.toFixed(2)} ~ ${maxBalance.toFixed(2)}`;
}

export function renderGrantTag(status: 'success' | 'pending' | 'failed') {
  const label = status === 'success' ? '成功' : status === 'pending' ? '处理中' : '失败';
  return <span className={`status-tag ${status}`}>{label}</span>;
}

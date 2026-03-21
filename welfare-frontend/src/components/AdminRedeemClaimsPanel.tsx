import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { api, isUnauthorizedError } from '../lib/api';
import type { AdminRedeemClaimList, AdminRedeemClaimQuery } from '../types';

interface AdminRedeemClaimsPanelProps {
  onUnauthorized: () => Promise<void>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

const defaultFilters: AdminRedeemClaimQuery = {
  page: 1,
  page_size: 10
};

const defaultFilterForm = {
  code: '',
  subject: '',
  grant_status: '' as '' | 'pending' | 'success' | 'failed'
};

function renderGrantTag(status: 'success' | 'pending' | 'failed') {
  const label = status === 'success' ? '成功' : status === 'pending' ? '处理中' : '失败';
  return <span className={`status-tag ${status}`}>{label}</span>;
}

export function AdminRedeemClaimsPanel({
  onUnauthorized,
  onError,
  onSuccess
}: AdminRedeemClaimsPanelProps) {
  const [claimList, setClaimList] = useState<AdminRedeemClaimList | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [filters, setFilters] = useState<AdminRedeemClaimQuery>(defaultFilters);
  const [filterForm, setFilterForm] = useState(defaultFilterForm);

  async function loadClaims(nextFilters: AdminRedeemClaimQuery = filters) {
    setLoading(true);
    try {
      onError('');
      const result = await api.listAdminRedeemClaims(nextFilters);
      setClaimList(result);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await onUnauthorized();
        return;
      }
      onSuccess('');
      onError(err instanceof Error ? err.message : '兑换明细加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadClaims(filters);
  }, [filters]);

  function applyFilters() {
    setFilters({
      page: 1,
      page_size: filters.page_size ?? defaultFilters.page_size,
      code: filterForm.code.trim() || undefined,
      subject: filterForm.subject.trim() || undefined,
      grant_status: filterForm.grant_status || undefined
    });
  }

  function resetFilters() {
    setFilterForm(defaultFilterForm);
    setFilters(defaultFilters);
  }

  function changePage(nextPage: number) {
    if (!claimList) return;
    if (nextPage < 1 || nextPage > claimList.pages || nextPage === claimList.page) {
      return;
    }
    setFilters((current) => ({
      ...current,
      page: nextPage
    }));
  }

  async function retryClaim(id: number) {
    setRetryingId(id);
    try {
      const result = await api.retryAdminRedeemClaim(id);
      await loadClaims(filters);
      onError('');
      onSuccess(
        `补发成功：${result.item.redeemCode} / ${result.item.linuxdoSubject}${
          result.new_balance !== null ? `，当前余额 ${result.new_balance}` : ''
        }`
      );
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await onUnauthorized();
        return;
      }
      onSuccess('');
      onError(err instanceof Error ? err.message : '兑换补发失败');
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <>
      <h2 className="section-title">
        <span className="section-title-content">
          <Icon name="chart" className="icon icon-accent" />
          <span>兑换记录</span>
        </span>
      </h2>

      <div className="panel">
        <div className="form-grid admin-checkin-filters">
          <label className="field">
            <span>兑换码</span>
            <input
              type="text"
              value={filterForm.code}
              placeholder="支持模糊搜索"
              onChange={(event) =>
                setFilterForm((current) => ({
                  ...current,
                  code: event.target.value
                }))
              }
            />
          </label>
          <label className="field">
            <span>LinuxDo Subject</span>
            <input
              type="text"
              value={filterForm.subject}
              placeholder="支持模糊搜索"
              onChange={(event) =>
                setFilterForm((current) => ({
                  ...current,
                  subject: event.target.value
                }))
              }
            />
          </label>
          <label className="field">
            <span>发放状态</span>
            <select
              value={filterForm.grant_status}
              onChange={(event) =>
                setFilterForm((current) => ({
                  ...current,
                  grant_status: event.target.value as typeof defaultFilterForm.grant_status
                }))
              }
            >
              <option value="">全部状态</option>
              <option value="pending">处理中</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
            </select>
          </label>
        </div>

        <div className="form-actions actions">
          <button className="button primary" onClick={applyFilters}>
            查询明细
          </button>
          <button className="button ghost" onClick={resetFilters}>
            重置筛选
          </button>
        </div>

        {claimList && (
          <div className="admin-stats-summary" style={{ marginTop: 16 }}>
            <span className="chip">总记录：{claimList.total}</span>
            <span className="chip">
              当前页：{claimList.page} / {claimList.pages}
            </span>
            <span className="chip">每页：{claimList.page_size}</span>
          </div>
        )}

        {loading ? (
          <p className="loading-text">正在加载兑换明细...</p>
        ) : claimList && claimList.items.length > 0 ? (
          <>
            <div className="list" style={{ marginTop: 16 }}>
              {claimList.items.map((item) => (
                <div key={item.id} className="list-item admin-redeem-claim-item">
                  <div className="stack">
                    <strong>{item.redeemTitle}</strong>
                    <span className="muted admin-redeem-meta">{item.redeemCode}</span>
                    <span className="muted admin-redeem-meta">{item.syntheticEmail}</span>
                  </div>

                  <div className="stack">
                    <strong>{item.linuxdoSubject}</strong>
                    <span className="muted admin-redeem-meta">
                      用户 #{item.sub2apiUserId}
                    </span>
                  </div>

                  <div className="stack">
                    <strong>{item.rewardBalance}</strong>
                    <span className="muted admin-redeem-meta">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <div className="stack">
                    {renderGrantTag(item.grantStatus)}
                    <span className="muted admin-redeem-meta">
                      {item.sub2apiRequestId || '无 request id'}
                    </span>
                  </div>

                  <div className="stack">
                    <span
                      className={`admin-checkin-error ${
                        item.grantStatus === 'failed' ? 'failed' : ''
                      }`}
                    >
                      {item.grantError || '发放成功'}
                    </span>
                    <span className="muted admin-redeem-meta">
                      幂等键：{item.idempotencyKey}
                    </span>
                  </div>

                  <div className="actions admin-checkin-actions">
                    {item.grantStatus !== 'success' ? (
                      <button
                        className="button danger"
                        onClick={() => retryClaim(item.id)}
                        disabled={retryingId === item.id}
                      >
                        {retryingId === item.id
                          ? '补发中...'
                          : item.grantStatus === 'pending'
                            ? '接管重试'
                            : '重试补发'}
                      </button>
                    ) : (
                      <span className="muted admin-redeem-meta">无需补发</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="pagination-bar">
              <button
                className="button ghost"
                disabled={claimList.page <= 1}
                onClick={() => changePage(claimList.page - 1)}
              >
                ← 上一页
              </button>
              <span className="muted">
                第 {claimList.page} / {claimList.pages} 页
              </span>
              <button
                className="button ghost"
                disabled={claimList.page >= claimList.pages}
                onClick={() => changePage(claimList.page + 1)}
              >
                下一页 →
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">暂无匹配的兑换记录</div>
        )}
      </div>
    </>
  );
}

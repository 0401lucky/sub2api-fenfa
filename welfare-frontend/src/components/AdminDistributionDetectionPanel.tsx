import { useEffect, useState } from 'react';
import { api, isUnauthorizedError } from '../lib/api';
import { formatAdminDateTime } from '../lib/admin-format';
import type {
  AdminRiskEvent,
  AdminRiskEventList,
  AdminRiskEventQuery,
  AdminRiskOverview
} from '../types';

interface AdminDistributionDetectionPanelProps {
  overview: AdminRiskOverview | null;
  onOverviewChange: (next: AdminRiskOverview) => void;
  onUnauthorized: () => Promise<void>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

const defaultFilters: AdminRiskEventQuery = {
  page: 1,
  page_size: 10
};

function renderRiskStatus(status: AdminRiskEvent['status']) {
  if (status === 'released') {
    return <span className="status-tag success">已恢复</span>;
  }

  if (status === 'pending_release') {
    return <span className="status-tag pending">待人工恢复</span>;
  }

  return <span className="status-tag failed">封禁中</span>;
}

function renderSyncStatus(status: AdminRiskEvent['mainSiteSyncStatus']) {
  if (status === 'success') {
    return <span className="status-tag success">主站已禁用</span>;
  }

  if (status === 'failed') {
    return <span className="status-tag failed">主站同步失败</span>;
  }

  return <span className="status-tag pending">主站待同步</span>;
}

function describeScanStatus(status: AdminRiskOverview['last_scan']['last_status']) {
  if (status === 'running') {
    return '扫描中';
  }

  if (status === 'failed') {
    return '最近失败';
  }

  if (status === 'success') {
    return '最近成功';
  }

  return '尚未执行';
}

function describeEventStatus(status: AdminRiskEvent['status']) {
  if (status === 'released') {
    return '已解除封锁，保留处置档案。';
  }

  if (status === 'pending_release') {
    return '最短锁定期已结束，等待管理员人工恢复。';
  }

  return '当前仍在锁定期内，福利站和主站都维持封禁。';
}

function buildIdentityMark(item: AdminRiskEvent): string {
  const source = (item.sub2apiUsername || item.sub2apiEmail || String(item.sub2apiUserId)).trim();
  return source.slice(0, 2).toUpperCase();
}

export function AdminDistributionDetectionPanel({
  overview,
  onOverviewChange,
  onUnauthorized,
  onError,
  onSuccess
}: AdminDistributionDetectionPanelProps) {
  const [filters, setFilters] = useState<AdminRiskEventQuery>(defaultFilters);
  const [list, setList] = useState<AdminRiskEventList | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [releasingId, setReleasingId] = useState<number | null>(null);
  const [releaseReason, setReleaseReason] = useState('');

  useEffect(() => {
    void refreshOverview();
  }, []);

  useEffect(() => {
    void loadEvents(filters);
  }, [filters]);

  async function refreshOverview() {
    try {
      const nextOverview = await api.getAdminRiskOverview();
      onOverviewChange(nextOverview);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await onUnauthorized();
        return;
      }

      onError(err instanceof Error ? err.message : '风险总览加载失败');
    }
  }

  async function loadEvents(nextFilters: AdminRiskEventQuery) {
    setLoading(true);
    try {
      const result = await api.listAdminRiskEvents(nextFilters);
      setList(result);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await onUnauthorized();
        return;
      }

      onError(err instanceof Error ? err.message : '风险事件加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleManualScan() {
    setScanning(true);
    try {
      const result = await api.scanAdminRiskEvents();
      await Promise.all([refreshOverview(), loadEvents(filters)]);
      onSuccess(
        `手动扫描完成：命中 ${result.matched_user_count} 人，新建 ${result.created_event_count} 条，刷新 ${result.refreshed_event_count} 条`
      );
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await onUnauthorized();
        return;
      }

      onError(err instanceof Error ? err.message : '手动扫描失败');
    } finally {
      setScanning(false);
    }
  }

  async function handleRelease(item: AdminRiskEvent) {
    const confirmed = window.confirm(
      `确认恢复用户 #${item.sub2apiUserId} 吗？该操作会把主站账号恢复为 active。`
    );
    if (!confirmed) {
      return;
    }

    setReleasingId(item.id);
    try {
      await api.releaseAdminRiskEvent(item.id, {
        reason: releaseReason.trim() || undefined
      });
      await Promise.all([refreshOverview(), loadEvents(filters)]);
      onSuccess(`已恢复用户 #${item.sub2apiUserId}`);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await onUnauthorized();
        return;
      }

      onError(err instanceof Error ? err.message : '手动恢复失败');
    } finally {
      setReleasingId(null);
    }
  }

  return (
    <div className="admin-section-stack distribution-control-room">
      <section className="panel distribution-hero-panel">
        <div className="distribution-hero-shell">
          <div className="distribution-hero-copy">
            <span className="distribution-kicker">Distribution Sentinel</span>
            <h3 className="distribution-hero-title">分发检测总览</h3>
            <p className="distribution-hero-description">
              用档案视角查看异常分发。这里优先展示锁定状态、主站同步结果和
              IP 证据，方便你快速判断是否该继续封禁或人工恢复。
            </p>

            <div className="distribution-metric-grid">
              <article className="distribution-metric-card">
                <span className="distribution-metric-label">封禁中</span>
                <strong className="distribution-metric-value">
                  {overview?.active_event_count ?? 0}
                </strong>
                <small>仍在最短锁定期内</small>
              </article>
              <article className="distribution-metric-card">
                <span className="distribution-metric-label">待人工恢复</span>
                <strong className="distribution-metric-value">
                  {overview?.pending_release_count ?? 0}
                </strong>
                <small>24 小时后进入待处理</small>
              </article>
              <article className="distribution-metric-card">
                <span className="distribution-metric-label">未结事件</span>
                <strong className="distribution-metric-value">
                  {overview?.open_event_count ?? 0}
                </strong>
                <small>后台与鉴权仍会继续拦截</small>
              </article>
            </div>
          </div>

          <div className="distribution-hero-side">
            <article className="distribution-scan-card">
              <div className="distribution-scan-head">
                <div>
                  <span className="distribution-kicker">Latest Sweep</span>
                  <strong>{describeScanStatus(overview?.last_scan.last_status ?? 'idle')}</strong>
                </div>
                <span className="chip distribution-scan-chip">
                  {overview?.last_scan.last_trigger_source || '未记录'}
                </span>
              </div>

              <div className="distribution-scan-list">
                <div className="distribution-scan-row">
                  <span>开始</span>
                  <strong>{formatAdminDateTime(overview?.last_scan.last_started_at)}</strong>
                </div>
                <div className="distribution-scan-row">
                  <span>结束</span>
                  <strong>{formatAdminDateTime(overview?.last_scan.last_finished_at)}</strong>
                </div>
                <div className="distribution-scan-row">
                  <span>更新</span>
                  <strong>{formatAdminDateTime(overview?.last_scan.updated_at)}</strong>
                </div>
              </div>

              <div className="distribution-scan-error">
                <span className="distribution-kicker">Last Error</span>
                <p>{overview?.last_scan.last_error || '无'}</p>
              </div>
            </article>

            <div className="distribution-action-card">
              <label className="field">
                <span>手动恢复备注</span>
                <input
                  type="text"
                  value={releaseReason}
                  onChange={(event) => setReleaseReason(event.target.value)}
                  placeholder="可选，记录本次恢复原因"
                />
              </label>

              <div className="form-actions actions distribution-action-row">
                <button
                  className="button primary"
                  disabled={scanning}
                  onClick={() => void handleManualScan()}
                >
                  {scanning ? '扫描中...' : '立即扫描'}
                </button>
                <button
                  className="button ghost"
                  onClick={() => void Promise.all([refreshOverview(), loadEvents(filters)])}
                >
                  刷新列表
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="panel distribution-events-panel">
        <div className="admin-panel-head distribution-events-head">
          <div className="distribution-events-copy">
            <span className="distribution-kicker">Risk Ledger</span>
            <h3 className="distribution-events-title">风险事件</h3>
            <p>
              每条事件都会拆开显示用户身份、命中窗口、IP 证据、主站联动结果和
              人工恢复信息，避免关键信息挤在一排里。
            </p>
          </div>

          <div className="distribution-filter-card">
            <label className="field">
              <span>事件状态</span>
              <select
                value={filters.status ?? ''}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    page: 1,
                    status:
                      event.target.value === ''
                        ? undefined
                        : (event.target.value as NonNullable<AdminRiskEventQuery['status']>)
                  }))
                }
              >
                <option value="">全部</option>
                <option value="active">封禁中</option>
                <option value="pending_release">待人工恢复</option>
                <option value="released">已恢复</option>
              </select>
            </label>
          </div>
        </div>

        {loading ? (
          <p className="loading-text">正在加载风险事件...</p>
        ) : !list || list.items.length === 0 ? (
          <div className="empty-state">当前没有风险事件。</div>
        ) : (
          <>
            <div className="distribution-event-list">
              {list.items.map((item) => (
                <article key={item.id} className="distribution-event-card">
                  <header className="distribution-event-head">
                    <div className="distribution-event-identity">
                      <div className="distribution-event-mark">
                        {buildIdentityMark(item)}
                      </div>
                      <div className="distribution-event-copy">
                        <strong>{item.sub2apiUsername || item.sub2apiEmail}</strong>
                        <span className="muted admin-redeem-meta">{item.sub2apiEmail}</span>
                        <span className="muted admin-redeem-meta">
                          sub2api #{item.sub2apiUserId}
                          {item.linuxdoSubject ? ` · ${item.linuxdoSubject}` : ''}
                        </span>
                      </div>
                    </div>

                    <div className="distribution-event-badges">
                      {renderRiskStatus(item.status)}
                      {renderSyncStatus(item.mainSiteSyncStatus)}
                    </div>
                  </header>

                  <div className="distribution-event-summary">
                    <p>{describeEventStatus(item.status)}</p>
                    <div className="distribution-event-summary-meta">
                      <span>角色 {item.sub2apiRole}</span>
                      <span>主站状态 {item.sub2apiStatus || '未知'}</span>
                      <span>扫描来源 {item.lastScanSource || '未记录'}</span>
                    </div>
                  </div>

                  <div className="distribution-event-grid">
                    <section className="distribution-event-block">
                      <span className="distribution-block-kicker">命中窗口</span>
                      <div className="distribution-fact-grid">
                        <div>
                          <span>首次命中</span>
                          <strong>{formatAdminDateTime(item.firstHitAt)}</strong>
                        </div>
                        <div>
                          <span>最近命中</span>
                          <strong>{formatAdminDateTime(item.lastHitAt)}</strong>
                        </div>
                        <div>
                          <span>窗口开始</span>
                          <strong>{formatAdminDateTime(item.windowStartedAt)}</strong>
                        </div>
                        <div>
                          <span>窗口结束</span>
                          <strong>{formatAdminDateTime(item.windowEndedAt)}</strong>
                        </div>
                        <div>
                          <span>最近扫描</span>
                          <strong>{formatAdminDateTime(item.lastScannedAt)}</strong>
                        </div>
                        <div>
                          <span>最短锁定至</span>
                          <strong>{formatAdminDateTime(item.minimumLockUntil)}</strong>
                        </div>
                      </div>
                    </section>

                    <section className="distribution-event-block distribution-event-evidence-block">
                      <div className="distribution-event-block-head">
                        <span className="distribution-block-kicker">IP 证据</span>
                        <strong>{item.distinctIpCount} 个不同 IP</strong>
                      </div>
                      <div className="distribution-ip-cloud">
                        {item.ipSamples.map((ip) => (
                          <span key={ip} className="distribution-ip-pill">
                            {ip}
                          </span>
                        ))}
                      </div>
                    </section>

                    <section className="distribution-event-block">
                      <span className="distribution-block-kicker">联动与恢复</span>
                      <div className="distribution-fact-stack">
                        <div className="distribution-fact-row">
                          <span>扫描状态</span>
                          <strong>{item.lastScanStatus}</strong>
                        </div>
                        <div className="distribution-fact-row">
                          <span>恢复时间</span>
                          <strong>{formatAdminDateTime(item.releasedAt)}</strong>
                        </div>
                        <div className="distribution-fact-row">
                          <span>恢复人</span>
                          <strong>{item.releasedByUsername || item.releasedByEmail || '未恢复'}</strong>
                        </div>
                      </div>
                      {item.releaseReason && (
                        <div className="distribution-inline-note">
                          <span className="distribution-block-kicker">恢复备注</span>
                          <p>{item.releaseReason}</p>
                        </div>
                      )}
                      {item.mainSiteSyncError && (
                        <div className="distribution-inline-note distribution-inline-note-danger">
                          <span className="distribution-block-kicker">主站同步错误</span>
                          <p>{item.mainSiteSyncError}</p>
                        </div>
                      )}
                    </section>
                  </div>

                  <footer className="distribution-event-foot">
                    <div className="distribution-event-foot-meta">
                      <span>创建于 {formatAdminDateTime(item.createdAt)}</span>
                      <span>更新于 {formatAdminDateTime(item.updatedAt)}</span>
                    </div>

                    <div className="actions distribution-event-actions">
                      {item.status === 'pending_release' ? (
                        <button
                          className="button primary"
                          disabled={releasingId === item.id}
                          onClick={() => void handleRelease(item)}
                        >
                          {releasingId === item.id ? '恢复中...' : '手动恢复'}
                        </button>
                      ) : (
                        <button className="button ghost" disabled>
                          {item.status === 'active' ? '锁定中' : '已完成'}
                        </button>
                      )}
                    </div>
                  </footer>
                </article>
              ))}
            </div>

            <div className="pagination-bar">
              <span className="muted">
                第 {list.page} / {list.pages} 页，共 {list.total} 条
              </span>
              <div className="actions">
                <button
                  className="button ghost"
                  disabled={list.page <= 1}
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      page: Math.max(1, (current.page ?? 1) - 1)
                    }))
                  }
                >
                  上一页
                </button>
                <button
                  className="button ghost"
                  disabled={list.page >= list.pages}
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      page: Math.min(list.pages, (current.page ?? 1) + 1)
                    }))
                  }
                >
                  下一页
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

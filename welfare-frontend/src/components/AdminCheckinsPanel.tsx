import { Icon } from './Icon';
import { formatAdminBusinessDate, formatAdminDateTime } from '../lib/admin-format';
import type { AdminCheckinItem, AdminCheckinList, AdminCheckinQuery, AdminSettings, DailyStats } from '../types';

interface AdminCheckinsPanelProps {
  settings: AdminSettings | null;
  dailyRewardInput: string;
  onDailyRewardInputChange: (value: string) => void;
  onSettingsChange: (next: AdminSettings) => void;
  stats: DailyStats | null;
  saving: boolean;
  onSaveSettings: () => Promise<void>;
  checkinList: AdminCheckinList | null;
  checkinsLoading: boolean;
  checkinFilters: AdminCheckinQuery;
  checkinFilterForm: {
    subject: string;
    grant_status: '' | 'pending' | 'success' | 'failed';
    date_from: string;
    date_to: string;
  };
  onCheckinFilterFormChange: (
    updater: (
      current: AdminCheckinsPanelProps['checkinFilterForm']
    ) => AdminCheckinsPanelProps['checkinFilterForm']
  ) => void;
  onApplyFilters: () => void;
  onResetFilters: () => void;
  retryingId: number | null;
  onRetryCheckin: (id: number) => Promise<void>;
  batchRetrying: boolean;
  batchRetryProgress: { done: number; total: number; successCount: number; failCount: number };
  onRetryAllFailed: () => Promise<void>;
  onChangePage: (nextPage: number) => void;
}

function renderGrantTag(status: AdminCheckinItem['grantStatus']) {
  const label = status === 'success' ? '成功' : status === 'pending' ? '处理中' : '失败';
  return <span className={`status-tag ${status}`}>{label}</span>;
}

export function AdminCheckinsPanel({
  settings,
  dailyRewardInput,
  onDailyRewardInputChange,
  onSettingsChange,
  stats,
  saving,
  onSaveSettings,
  checkinList,
  checkinsLoading,
  checkinFilterForm,
  onCheckinFilterFormChange,
  onApplyFilters,
  onResetFilters,
  retryingId,
  onRetryCheckin,
  batchRetrying,
  batchRetryProgress,
  onRetryAllFailed,
  onChangePage
}: AdminCheckinsPanelProps) {
  return (
    <div className="admin-section-stack">
      {settings && (
        <div className="admin-two-column">
          <div className="panel">
            <h2 className="section-title">
              <span className="section-title-content">
                <Icon name="settings" className="icon icon-accent" />
                <span>签到配置</span>
              </span>
            </h2>
            <div className="form-grid">
              <label className="field">
                <span>签到开关</span>
                <input
                  type="checkbox"
                  checked={settings.checkin_enabled}
                  onChange={(event) =>
                    onSettingsChange({
                      ...settings,
                      checkin_enabled: event.target.checked
                    })
                  }
                />
              </label>
              <label className="field">
                <span>每日奖励余额</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={dailyRewardInput}
                  onChange={(event) => onDailyRewardInputChange(event.target.value)}
                />
              </label>
              <label className="field">
                <span>业务时区</span>
                <input
                  type="text"
                  value={settings.timezone}
                  onChange={(event) =>
                    onSettingsChange({
                      ...settings,
                      timezone: event.target.value
                    })
                  }
                />
              </label>
            </div>
            <div className="form-actions">
              <button className="button primary" onClick={() => void onSaveSettings()} disabled={saving}>
                {saving ? '保存中...' : '保存设置'}
              </button>
            </div>
          </div>

          <div className="panel">
            <h2 className="section-title">
              <span className="section-title-content">
                <Icon name="chart" className="icon icon-accent" />
                <span>30 天签到统计</span>
              </span>
            </h2>
            {stats && (
              <>
                <div className="admin-stats-summary">
                  <span className="chip">签到用户数：{stats.active_users}</span>
                  <span className="chip">签到人次：{stats.total_checkins}</span>
                  <span className="chip">发放总额：{stats.total_grant_balance}</span>
                </div>
                <div className="list">
                  {stats.points.slice(-5).reverse().map((point) => (
                  <div key={point.checkinDate} className="list-item admin-list-compact">
                      <strong>{formatAdminBusinessDate(point.checkinDate)}</strong>
                      <span className="muted">人数: {point.checkinUsers}</span>
                      <span className="muted">发放: {point.grantTotal}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="panel">
        <h2 className="section-title">
          <span className="section-title-content">
            <Icon name="gift" className="icon icon-accent" />
            <span>签到明细</span>
          </span>
        </h2>

        {/* 一键补发区域 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <button
            className="button danger"
            onClick={() => void onRetryAllFailed()}
            disabled={batchRetrying}
          >
            {batchRetrying ? `补发中... (${batchRetryProgress.done}/${batchRetryProgress.total})` : '⚙ 一键补发所有失败'}
          </button>
          {batchRetrying && batchRetryProgress.total > 0 && (
            <div style={{ flex: 1, minWidth: 120 }}>
              <div className="admin-progress-track">
                <span
                  style={{
                    width: `${(batchRetryProgress.done / batchRetryProgress.total) * 100}%`,
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>
              <span className="muted" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                成功 {batchRetryProgress.successCount}、失败 {batchRetryProgress.failCount}、剩余 {batchRetryProgress.total - batchRetryProgress.done}
              </span>
            </div>
          )}
        </div>
        <div className="form-grid admin-checkin-filters">
          <label className="field">
            <span>LinuxDo Subject</span>
            <input
              type="text"
              value={checkinFilterForm.subject}
              onChange={(event) =>
                onCheckinFilterFormChange((current) => ({
                  ...current,
                  subject: event.target.value
                }))
              }
              placeholder="支持模糊搜索"
            />
          </label>
          <label className="field">
            <span>发放状态</span>
            <select
              value={checkinFilterForm.grant_status}
              onChange={(event) =>
                onCheckinFilterFormChange((current) => ({
                  ...current,
                  grant_status: event.target.value as typeof current.grant_status
                }))
              }
            >
              <option value="">全部状态</option>
              <option value="pending">处理中</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
            </select>
          </label>
          <label className="field">
            <span>开始日期</span>
            <input
              type="date"
              value={checkinFilterForm.date_from}
              onChange={(event) =>
                onCheckinFilterFormChange((current) => ({
                  ...current,
                  date_from: event.target.value
                }))
              }
            />
          </label>
          <label className="field">
            <span>结束日期</span>
            <input
              type="date"
              value={checkinFilterForm.date_to}
              onChange={(event) =>
                onCheckinFilterFormChange((current) => ({
                  ...current,
                  date_to: event.target.value
                }))
              }
            />
          </label>
        </div>

        <div className="form-actions actions">
          <button className="button primary" onClick={onApplyFilters}>
            查询明细
          </button>
          <button className="button ghost" onClick={onResetFilters}>
            重置筛选
          </button>
        </div>

        {checkinList && (
          <div className="admin-stats-summary" style={{ marginTop: 16 }}>
            <span className="chip">总记录：{checkinList.total}</span>
            <span className="chip">当前页：{checkinList.page} / {checkinList.pages}</span>
            <span className="chip">每页：{checkinList.page_size}</span>
          </div>
        )}

        {checkinsLoading ? (
          <p className="loading-text">正在加载签到明细...</p>
        ) : checkinList && checkinList.items.length > 0 ? (
          <>
            <div className="list" style={{ marginTop: 16 }}>
              {checkinList.items.map((item) => (
                <div key={item.id} className="list-item admin-checkin-item">
                  <div className="stack">
                    <strong>{item.linuxdoSubject}</strong>
                    <span className="muted admin-checkin-meta">{item.syntheticEmail}</span>
                    <span className="muted admin-checkin-meta">用户 #{item.sub2apiUserId}</span>
                  </div>

                  <div className="stack">
                    <strong>{formatAdminBusinessDate(item.checkinDate)}</strong>
                    <span className="muted admin-checkin-meta">
                      {formatAdminDateTime(item.createdAt)}
                    </span>
                  </div>

                  <div className="stack">
                    <strong>{item.rewardBalance}</strong>
                    <span className="muted admin-checkin-meta">发放额度</span>
                  </div>

                  <div className="stack">
                    {renderGrantTag(item.grantStatus)}
                    <span className="muted admin-checkin-meta">
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
                    <span className="muted admin-checkin-meta">幂等键：{item.idempotencyKey}</span>
                  </div>

                  <div className="actions admin-checkin-actions">
                    {item.grantStatus !== 'success' ? (
                      <button
                        className="button danger"
                        onClick={() => void onRetryCheckin(item.id)}
                        disabled={retryingId === item.id}
                      >
                        {retryingId === item.id
                          ? '补发中...'
                          : item.grantStatus === 'pending'
                            ? '接管重试'
                            : '重试补发'}
                      </button>
                    ) : (
                      <span className="muted admin-checkin-meta">无需补发</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="pagination-bar">
              <span className="muted admin-checkin-meta">
                共 {checkinList.total} 条，当前展示第 {checkinList.page} 页
              </span>
              <div className="actions">
                <button
                  className="button ghost"
                  onClick={() => onChangePage(checkinList.page - 1)}
                  disabled={checkinList.page <= 1}
                >
                  上一页
                </button>
                <button
                  className="button ghost"
                  onClick={() => onChangePage(checkinList.page + 1)}
                  disabled={checkinList.page >= checkinList.pages}
                >
                  下一页
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state" style={{ marginTop: 16 }}>
            当前筛选条件下没有签到记录。
          </div>
        )}
      </div>
    </div>
  );
}

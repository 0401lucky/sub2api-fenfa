import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { AdminRedeemCodesPanel } from '../components/AdminRedeemCodesPanel';
import { AdminRedeemClaimsPanel } from '../components/AdminRedeemClaimsPanel';
import { useAuth } from '../lib/auth';
import { api, isUnauthorizedError } from '../lib/api';
import type {
  AdminCheckinItem,
  AdminCheckinList,
  AdminCheckinQuery,
  AdminSettings,
  DailyStats,
  WhitelistItem
} from '../types';

const defaultCheckinFilters: AdminCheckinQuery = {
  page: 1,
  page_size: 10
};

const defaultCheckinFilterForm = {
  subject: '',
  grant_status: '' as '' | 'pending' | 'success' | 'failed',
  date_from: '',
  date_to: ''
};

function renderGrantTag(status: AdminCheckinItem['grantStatus']) {
  const label = status === 'success' ? '成功' : status === 'pending' ? '处理中' : '失败';
  return <span className={`status-tag ${status}`}>{label}</span>;
}

export function AdminPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [dailyRewardInput, setDailyRewardInput] = useState('');
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [checkinList, setCheckinList] = useState<AdminCheckinList | null>(null);
  const [checkinFilters, setCheckinFilters] = useState<AdminCheckinQuery>(defaultCheckinFilters);
  const [checkinFilterForm, setCheckinFilterForm] = useState(defaultCheckinFilterForm);
  const [whitelist, setWhitelist] = useState<WhitelistItem[]>([]);
  const [newSubject, setNewSubject] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [checkinsLoading, setCheckinsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function redirectToLogin() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function loadOverview() {
    setLoading(true);
    setError('');
    try {
      const overview = await api.getAdminOverview();
      setSettings(overview.settings);
      setDailyRewardInput(String(overview.settings.daily_reward_balance));
      setStats(overview.stats);
      setWhitelist(overview.whitelist);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadCheckins(filters: AdminCheckinQuery = checkinFilters) {
    setCheckinsLoading(true);
    setError('');
    try {
      const result = await api.listAdminCheckins(filters);
      setCheckinList(result);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '签到明细加载失败');
    } finally {
      setCheckinsLoading(false);
    }
  }

  useEffect(() => {
    if (!user?.is_admin) {
      return;
    }
    void loadOverview();
  }, [user?.is_admin]);

  useEffect(() => {
    if (!user?.is_admin) {
      return;
    }
    void loadCheckins(checkinFilters);
  }, [checkinFilters, user?.is_admin]);

  async function saveSettings() {
    if (!settings) return;
    const parsedReward = Number(dailyRewardInput);
    if (!Number.isFinite(parsedReward) || parsedReward <= 0) {
      setError('每日奖励余额必须大于 0');
      setMessage('');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const updated = await api.updateAdminSettings({
        ...settings,
        daily_reward_balance: parsedReward
      });
      setSettings(updated);
      setDailyRewardInput(String(updated.daily_reward_balance));
      setMessage('设置保存成功');
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function addWhitelist() {
    if (!newSubject.trim()) return;
    setError('');
    setMessage('');
    try {
      const created = await api.addWhitelist({
        linuxdo_subject: newSubject.trim(),
        notes: newNotes.trim() || undefined
      });
      setNewSubject('');
      setNewNotes('');
      setWhitelist((current) => {
        const filtered = current.filter((item) => item.id !== created.id);
        return [...filtered, created].sort((a, b) => a.id - b.id);
      });
      setMessage('已添加管理员白名单');
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '新增失败');
    }
  }

  async function removeWhitelist(id: number) {
    setError('');
    setMessage('');
    try {
      await api.removeWhitelist(id);
      setWhitelist((current) => current.filter((item) => item.id !== id));
      setMessage('已删除白名单');
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '删除失败');
    }
  }

  function applyCheckinFilters() {
    if (
      checkinFilterForm.date_from &&
      checkinFilterForm.date_to &&
      checkinFilterForm.date_from > checkinFilterForm.date_to
    ) {
      setError('开始日期不能晚于结束日期');
      return;
    }

    setCheckinFilters({
      page: 1,
      page_size: checkinFilters.page_size ?? defaultCheckinFilters.page_size,
      subject: checkinFilterForm.subject.trim() || undefined,
      grant_status: checkinFilterForm.grant_status || undefined,
      date_from: checkinFilterForm.date_from || undefined,
      date_to: checkinFilterForm.date_to || undefined
    });
  }

  function resetCheckinFilters() {
    setCheckinFilterForm(defaultCheckinFilterForm);
    setCheckinFilters(defaultCheckinFilters);
  }

  function changeCheckinPage(nextPage: number) {
    if (!checkinList) return;
    if (nextPage < 1 || nextPage > checkinList.pages || nextPage === checkinList.page) {
      return;
    }
    setCheckinFilters((current) => ({
      ...current,
      page: nextPage
    }));
  }

  async function retryCheckin(id: number) {
    setRetryingId(id);
    setError('');
    setMessage('');
    try {
      const result = await api.retryAdminCheckin(id);
      const [statsResp] = await Promise.all([
        api.getDailyStats(30),
        loadCheckins(checkinFilters)
      ]);
      setStats(statsResp);
      setMessage(
        `补发成功：${result.item.linuxdoSubject} / ${result.item.checkinDate}${
          result.new_balance !== null ? `，当前余额 ${result.new_balance}` : ''
        }`
      );
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '补发失败');
    } finally {
      setRetryingId(null);
    }
  }

  if (loading) {
    return (
      <div className="page page-center">
        <div className="card auth-card">
          <span className="eyebrow">管理后台</span>
          <h1 className="hero-title">福利后台</h1>
          <p className="loading-text">加载中...</p>
        </div>
      </div>
    );
  }

  if (!user?.is_admin) {
    return (
      <div className="page page-center">
        <div className="card auth-card">
          <span className="eyebrow">无权限</span>
          <h1 className="hero-title">无权限访问</h1>
          <p className="alert error">{error || '当前账号不在管理员白名单中'}</p>
          <Link to="/checkin" className="button" style={{ marginTop: 12 }}>
            → 返回签到页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="card">
        <div className="row topbar">
          <div>
            <span className="eyebrow">管理后台</span>
            <h1 className="hero-title">福利后台管理</h1>
            <div className="user-info">
              {user.avatar_url && (
                <img
                  className="user-avatar user-avatar-sm"
                  src={user.avatar_url}
                  alt={user.username}
                />
              )}
              <p className="muted" style={{ marginTop: 0 }}>
                管理员：{user.username}
              </p>
            </div>
          </div>
          <div className="actions">
            <Link to="/checkin" className="button ghost">
              → 签到页
            </Link>
          </div>
        </div>

        {error && <p className="alert error">{error}</p>}
        {message && <p className="alert success">{message}</p>}

        <h2 className="section-title">
          <span className="section-title-content">
            <Icon name="settings" className="icon icon-accent" />
            <span>签到配置</span>
          </span>
        </h2>
        {settings && (
          <div className="panel">
            <div className="form-grid">
              <label className="field">
                <span>签到开关</span>
                <input
                  type="checkbox"
                  checked={settings.checkin_enabled}
                  onChange={(event) =>
                    setSettings({ ...settings, checkin_enabled: event.target.checked })
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
                  onChange={(event) => setDailyRewardInput(event.target.value)}
                />
              </label>
              <label className="field">
                <span>业务时区</span>
                <input
                  type="text"
                  value={settings.timezone}
                  onChange={(event) =>
                    setSettings({ ...settings, timezone: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="form-actions">
              <button className="button primary" onClick={saveSettings} disabled={saving}>
                {saving ? '保存中...' : '保存设置'}
              </button>
            </div>
          </div>
        )}

        <h2 className="section-title">
          <span className="section-title-content">
            <Icon name="chart" className="icon icon-accent" />
            <span>30 天签到统计</span>
          </span>
        </h2>
        {stats && (
          <div className="panel">
            <div className="admin-stats-summary">
              <span className="chip">签到用户数：{stats.active_users}</span>
              <span className="chip">签到人次：{stats.total_checkins}</span>
              <span className="chip">发放总额：{stats.total_grant_balance}</span>
            </div>
            <div className="list">
              {stats.points.map((point) => (
                <div key={point.checkinDate} className="list-item">
                  <strong>{point.checkinDate}</strong>
                  <span className="muted">人数: {point.checkinUsers}</span>
                  <span className="muted">发放: {point.grantTotal}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <AdminRedeemCodesPanel
          onUnauthorized={redirectToLogin}
          onError={setError}
          onSuccess={setMessage}
        />

        <AdminRedeemClaimsPanel
          onUnauthorized={redirectToLogin}
          onError={setError}
          onSuccess={setMessage}
        />

        <h2 className="section-title">
          <span className="section-title-content">
            <Icon name="gift" className="icon icon-accent" />
            <span>签到明细</span>
          </span>
        </h2>
        <div className="panel">
          <div className="form-grid admin-checkin-filters">
            <label className="field">
              <span>LinuxDo Subject</span>
              <input
                type="text"
                value={checkinFilterForm.subject}
                onChange={(event) =>
                  setCheckinFilterForm((current) => ({
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
                  setCheckinFilterForm((current) => ({
                    ...current,
                    grant_status: event.target.value as typeof defaultCheckinFilterForm.grant_status
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
                  setCheckinFilterForm((current) => ({
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
                  setCheckinFilterForm((current) => ({
                    ...current,
                    date_to: event.target.value
                  }))
                }
              />
            </label>
          </div>

          <div className="form-actions actions">
            <button className="button primary" onClick={applyCheckinFilters}>
              查询明细
            </button>
            <button className="button ghost" onClick={resetCheckinFilters}>
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
                      <span className="muted admin-checkin-meta">
                        用户 #{item.sub2apiUserId}
                      </span>
                    </div>

                    <div className="stack">
                      <strong>{item.checkinDate}</strong>
                      <span className="muted admin-checkin-meta">
                        {new Date(item.createdAt).toLocaleString()}
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
                      <span className="muted admin-checkin-meta">
                        幂等键：{item.idempotencyKey}
                      </span>
                    </div>

                    <div className="actions admin-checkin-actions">
                      {item.grantStatus !== 'success' ? (
                        <button
                          className="button danger"
                          onClick={() => retryCheckin(item.id)}
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
                    onClick={() => changeCheckinPage(checkinList.page - 1)}
                    disabled={checkinList.page <= 1}
                  >
                    上一页
                  </button>
                  <button
                    className="button ghost"
                    onClick={() => changeCheckinPage(checkinList.page + 1)}
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

        <h2 className="section-title">
          <span className="section-title-content">
            <Icon name="shield" className="icon icon-accent" />
            <span>管理员白名单</span>
          </span>
        </h2>
        <div className="panel">
          <div className="form-grid">
            <label className="field">
              <span>LinuxDo Subject</span>
              <input value={newSubject} onChange={(event) => setNewSubject(event.target.value)} />
            </label>
            <label className="field">
              <span>备注</span>
              <input value={newNotes} onChange={(event) => setNewNotes(event.target.value)} />
            </label>
          </div>
          <div className="form-actions">
            <button className="button" onClick={addWhitelist}>
              添加白名单
            </button>
          </div>

          <div className="list" style={{ marginTop: 16 }}>
            {whitelist.map((item) => (
              <div key={item.id} className="list-item">
                <strong>{item.linuxdoSubject}</strong>
                <span className="muted">{item.notes || '-'}</span>
                <span className="muted" style={{ fontSize: 13 }}>
                  {new Date(item.createdAt).toLocaleString()}
                </span>
                <button className="button danger" onClick={() => removeWhitelist(item.id)}>
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../lib/auth';
import { api, isUnauthorizedError } from '../lib/api';
import type { AdminSettings, DailyStats, WhitelistItem } from '../types';

export function AdminPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [whitelist, setWhitelist] = useState<WhitelistItem[]>([]);
  const [newSubject, setNewSubject] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function redirectToLogin() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [settingsResp, statsResp, whitelistResp] = await Promise.all([
        api.getAdminSettings(),
        api.getDailyStats(30),
        api.listWhitelist()
      ]);
      setSettings(settingsResp);
      setStats(statsResp);
      setWhitelist(whitelistResp);
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

  useEffect(() => {
    void loadAll();
  }, []);

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const updated = await api.updateAdminSettings(settings);
      setSettings(updated);
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
      await api.addWhitelist({
        linuxdo_subject: newSubject.trim(),
        notes: newNotes.trim() || undefined
      });
      setNewSubject('');
      setNewNotes('');
      setWhitelist(await api.listWhitelist());
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
      setWhitelist(await api.listWhitelist());
      setMessage('已删除白名单');
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '删除失败');
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
                  value={settings.daily_reward_balance}
                  onChange={(event) =>
                    setSettings({ ...settings, daily_reward_balance: Number(event.target.value) })
                  }
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

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../lib/auth';
import { api, isUnauthorizedError } from '../lib/api';
import type { CheckinHistoryItem, CheckinStatus } from '../types';

function checkinStatusText(status: CheckinStatus | null): string {
  if (!status) return '-';
  if (status.checked_in) return '已签到';
  if (status.grant_status === 'pending') return '处理中';
  return '未签到';
}

function renderGrantTag(status: CheckinHistoryItem['grant_status']) {
  const label = status === 'success' ? '成功' : status === 'pending' ? '处理中' : '失败';
  return <span className={`status-tag ${status}`}>{label}</span>;
}

export function CheckinPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [status, setStatus] = useState<CheckinStatus | null>(null);
  const [history, setHistory] = useState<CheckinHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function redirectToLogin() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [currentStatus, records] = await Promise.all([
        api.getCheckinStatus(),
        api.getCheckinHistory()
      ]);
      setStatus(currentStatus);
      setHistory(records);
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

  const canCheckin = useMemo(() => {
    if (!status) return false;
    return status.checkin_enabled && !status.checked_in && !submitting;
  }, [status, submitting]);

  async function handleCheckin() {
    if (!canCheckin) return;
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.checkin();
      setSuccess(
        `签到成功，已发放 ${result.reward_balance}，当前余额 ${result.new_balance ?? '未知'}`
      );
      await loadAll();
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '签到失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    await redirectToLogin();
  }

  if (loading) {
    return (
      <div className="page page-center">
        <div className="card auth-card">
          <span className="eyebrow">签到</span>
          <h1 className="hero-title">每日签到</h1>
          <p className="loading-text">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="card">
        <div className="row topbar">
          <div>
            <span className="eyebrow">签到中心</span>
            <h1 className="hero-title">每日签到</h1>
            <div className="user-info">
              {user?.avatar_url && (
                <img
                  className="user-avatar"
                  src={user.avatar_url}
                  alt={user.username}
                />
              )}
              <p className="muted" style={{ marginTop: 0 }}>
                {user?.username}（sub2api #{user?.sub2api_user_id}）
              </p>
            </div>
          </div>
          <div className="actions">
            {user?.is_admin && (
              <Link to="/admin" className="button ghost">
                <span className="button-content">
                  <Icon name="settings" className="icon" size={16} />
                  <span>后台管理</span>
                </span>
              </Link>
            )}
            <button className="button" onClick={handleLogout}>
              退出
            </button>
          </div>
        </div>

        {status && (
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">业务日</div>
              <div className="stat-value">{status.checkin_date}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">时区</div>
              <div className="stat-value">{status.timezone}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">今日奖励</div>
              <div className="stat-value warning">{status.daily_reward_balance}</div>
            </div>
            <div className="stat-card">
              <div className={`stat-value ${status.checked_in ? 'success' : ''}`}>
                {checkinStatusText(status)}
              </div>
              <div className="stat-label">签到状态</div>
            </div>
          </div>
        )}

        <div className="row section-bar">
          <h2 className="section-title">签到操作</h2>
          <button className="button primary" disabled={!canCheckin} onClick={handleCheckin}>
            {submitting ? (
              '签到中...'
            ) : (
              <span className="button-content">
                <Icon name="gift" className="icon" size={16} />
                <span>立即签到</span>
              </span>
            )}
          </button>
        </div>

        {success && <p className="alert success">{success}</p>}
        {error && <p className="alert error">{error}</p>}

        <h2 className="section-title">签到历史</h2>
        <div className="list">
          {history.length === 0 && <p className="muted">暂无签到记录</p>}
          {history.map((item) => (
            <div key={item.id} className="list-item">
              <div className="stack">
                <strong>{item.checkin_date}</strong>
                <span className="muted" style={{ fontSize: 13 }}>
                  奖励 {item.reward_balance}
                </span>
              </div>
              {renderGrantTag(item.grant_status)}
              <span className="muted" style={{ fontSize: 13 }}>
                {new Date(item.created_at).toLocaleString()}
              </span>
              <span className="muted" style={{ fontSize: 13 }}>
                {item.grant_error || '发放成功'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../lib/auth';
import { api, isUnauthorizedError } from '../lib/api';
import type { CheckinHistoryItem, CheckinStatus, RedeemHistoryItem } from '../types';
import { motion } from 'framer-motion';
import { pageVariants, staggerContainer, staggerItem } from '../lib/animations';

function checkinStatusText(status: CheckinStatus | null): string {
  if (!status) return '-';
  if (status.checked_in) return '已签到';
  if (status.grant_status === 'pending') return '处理中';
  return '未签到';
}

function renderGrantTag(status: 'success' | 'pending' | 'failed') {
  const label = status === 'success' ? '成功' : status === 'pending' ? '处理中' : '失败';
  return <span className={`status-tag ${status}`}>{label}</span>;
}

function getCheckinButtonText(status: CheckinStatus | null, submitting: boolean): string {
  if (submitting) return '签到中...';
  if (!status) return '立即签到';
  if (status.checked_in) return '今日已签到';
  if (status.grant_status === 'pending' && !status.can_checkin) return '处理中...';
  if (status.grant_status === 'pending' && status.can_checkin) return '重新处理签到';
  if (status.grant_status === 'failed') return '重新签到';
  return '立即签到';
}

export function CheckinPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [status, setStatus] = useState<CheckinStatus | null>(null);
  const [history, setHistory] = useState<CheckinHistoryItem[]>([]);
  const [redeemHistory, setRedeemHistory] = useState<RedeemHistoryItem[]>([]);
  const [redeemCodeInput, setRedeemCodeInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [redeemSubmitting, setRedeemSubmitting] = useState(false);
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
      const [currentStatus, records, redeemRecords] = await Promise.all([
        api.getCheckinStatus(),
        api.getCheckinHistory(),
        api.getRedeemHistory()
      ]);
      setStatus(currentStatus);
      setHistory(records);
      setRedeemHistory(redeemRecords);
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
    return status.checkin_enabled && status.can_checkin && !submitting;
  }, [status, submitting]);

  const canRedeem = useMemo(
    () => redeemCodeInput.trim() !== '' && !redeemSubmitting,
    [redeemCodeInput, redeemSubmitting]
  );

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

  async function handleRedeem() {
    if (!canRedeem) return;
    setRedeemSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.redeemCode({
        code: redeemCodeInput.trim()
      });
      setRedeemCodeInput('');
      setSuccess(
        `兑换成功，${result.title} 已发放 ${result.reward_balance}，当前余额 ${
          result.new_balance ?? '未知'
        }`
      );
      await loadAll();
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '兑换失败');
    } finally {
      setRedeemSubmitting(false);
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
    <motion.div 
      className="page"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div variants={staggerContainer} initial="initial" animate="animate" className="checkin-layout">
        
        {/* === Header === */}
        <motion.header variants={staggerItem} className="checkin-header">
          <div className="user-info">
            {user?.avatar_url && (
              <img
                className="user-avatar"
                src={user.avatar_url}
                alt={user.username}
              />
            )}
            <div>
              <h1 className="hero-title" style={{ fontSize: 24, marginBottom: 2 }}>
                欢迎回来, <span className="text-gradient">{user?.username}</span>
              </h1>
              <p className="muted" style={{ margin: 0 }}>sub2api #{user?.sub2api_user_id}</p>
            </div>
          </div>
          <div className="actions">
            {user?.is_admin && (
              <Link to="/admin" className="button ghost">
                <Icon name="settings" size={16} /> 后台管理
              </Link>
            )}
            <button className="button danger" onClick={handleLogout}>退出</button>
          </div>
        </motion.header>

        {/* === Hero Widget === */}
        <motion.div variants={staggerItem} className="checkin-hero-widget">
          {status ? (
            <>
              <div className="checkin-hero-amount">
                ${status.daily_reward_balance.toFixed(2)}
              </div>
              <div className="checkin-hero-status">
                {status.checkin_date} ({status.timezone}) · 今日奖励额度
              </div>
              <button
                className={`button checkin-big-btn ${status.checked_in ? 'ghost' : 'primary'}`}
                disabled={!canCheckin}
                onClick={handleCheckin}
              >
                {submitting ? '签到中...' : status.checked_in ? '✓ 今日已签到' : '立即签到领取'}
              </button>
              {error && !redeemSubmitting && <p className="alert error" style={{marginTop: 16}}>{error}</p>}
              {success && !redeemSubmitting && <p className="alert success" style={{marginTop: 16}}>{success}</p>}
            </>
          ) : (
            <p className="loading-text">加载状态中...</p>
          )}
        </motion.div>

        {/* === Redeem Panel === */}
        <motion.div variants={staggerItem} className="panel">
          <div className="section-head">
            <h2 className="section-title">兑换福利码</h2>
          </div>
          <div className="redeem-form-row">
            <div className="field redeem-field">
              <span>福利码 (Code)</span>
              <input
                type="text"
                value={redeemCodeInput}
                onChange={(e) => setRedeemCodeInput(e.target.value)}
                placeholder="在此输入福利分发码"
                disabled={redeemSubmitting}
              />
            </div>
            <div className="redeem-action">
              <button
                className="button primary wide"
                disabled={!canRedeem}
                onClick={handleRedeem}
              >
                {redeemSubmitting ? '兑换中...' : '立即兑换'}
              </button>
            </div>
          </div>
          {success && !redeemSubmitting && success.includes('兑换成功') && (
            <div className="alert success">{success}</div>
          )}
          {error && !redeemSubmitting && error.includes('兑换失败') && (
            <div className="alert error">{error}</div>
          )}
        </motion.div>

        {/* === History Columns === */}
        <div className="checkin-history-columns">
          <motion.div variants={staggerItem} className="panel" style={{ margin: 0 }}>
            <div className="section-head">
              <h2 className="section-title" style={{ fontSize: 20 }}>签到记录</h2>
            </div>
            {history.length === 0 ? (
              <p className="muted">暂无历史记录</p>
            ) : (
              <div className="list">
                {history.map((item) => (
                  <div key={item.id} className="list-item" style={{ gridTemplateColumns: 'minmax(120px, 1fr) 70px auto', padding: '12px 16px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <strong style={{ fontSize: 14 }}>{new Date(item.checkin_date).toLocaleDateString()}</strong>
                      <span className="muted" style={{ fontSize: 13 }}>{new Date(item.created_at).toLocaleTimeString()}</span>
                    </div>
                    {renderGrantTag(item.grant_status)}
                    <span style={{ fontWeight: 600, textAlign: 'right', color: 'var(--aurora-1)' }}>+{item.reward_balance}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          <motion.div variants={staggerItem} className="panel" style={{ margin: 0 }}>
            <div className="section-head">
              <h2 className="section-title" style={{ fontSize: 20 }}>兑换记录</h2>
            </div>
            {redeemHistory.length === 0 ? (
              <p className="muted">暂无历史记录</p>
            ) : (
              <div className="list">
                {redeemHistory.map((item) => (
                  <div key={item.id} className="list-item" style={{ gridTemplateColumns: 'minmax(120px, 1fr) 70px auto', padding: '12px 16px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <strong style={{ fontSize: 14 }}>{item.redeem_code}</strong>
                      <span className="muted" style={{ fontSize: 13 }}>{new Date(item.created_at).toLocaleTimeString()}</span>
                    </div>
                    {renderGrantTag(item.grant_status)}
                    <span style={{ fontWeight: 600, textAlign: 'right', color: 'var(--aurora-1)' }}>+{item.reward_balance}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </div>

      </motion.div>
    </motion.div>
  );
}

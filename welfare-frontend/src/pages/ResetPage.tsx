import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, isUnauthorizedError } from '../lib/api';
import { pageVariants, staggerContainer, staggerItem } from '../lib/animations';
import { formatAdminTime } from '../lib/admin-format';
import { renderGrantTag } from '../lib/welfare-display';
import type { ResetHistoryItem, ResetStatus } from '../types';

function formatBalance(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return '--';
  }
  return value.toFixed(2);
}

export function ResetPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [status, setStatus] = useState<ResetStatus | null>(null);
  const [history, setHistory] = useState<ResetHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function redirectToLogin() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function loadAll(showLoading = false) {
    if (showLoading) {
      setLoading(true);
    }

    setError('');
    try {
      const [resetStatus, resetHistory] = await Promise.all([
        api.getResetStatus(),
        api.getResetHistory()
      ]);
      setStatus(resetStatus);
      setHistory(resetHistory);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }

      setError(err instanceof Error ? err.message : '重置状态加载失败');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadAll(true);
  }, []);

  async function handleApply() {
    if (!status?.can_apply || applying) {
      return;
    }

    setApplying(true);
    setError('');
    setSuccess('');

    try {
      const result = await api.applyReset();
      setSuccess(
        `重置成功，本次补差 ${result.granted_balance}，当前余额 ${result.new_balance}`
      );
      await loadAll();
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }

      setError(
        `重置失败：${err instanceof Error && err.message ? err.message : '请稍后重试'}`
      );
      await loadAll();
    } finally {
      setApplying(false);
    }
  }

  return (
    <motion.div
      className="page utility-page"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        className="utility-page-stack"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <motion.section variants={staggerItem} className="panel reset-hero">
          <div className="reset-hero-head">
            <div>
              <span className="eyebrow">Quota Reset</span>
              <h1 className="hero-title utility-title">额度重置</h1>
              <p className="lead utility-lead">低于阈值时，可直接补到目标值。</p>
            </div>
            <div className={`reset-availability ${status?.can_apply ? 'ready' : 'locked'}`}>
              <strong>{status?.can_apply ? '可立即重置' : '当前不可重置'}</strong>
              <span>{status?.reason || '满足条件后可直接补到目标值'}</span>
            </div>
          </div>
          <div className="utility-chip-row">
            <span className="chip">当前余额 {formatBalance(status?.current_balance)}</span>
            <span className="chip">阈值 {formatBalance(status?.threshold_balance)}</span>
            <span className="chip">目标值 {formatBalance(status?.target_balance)}</span>
            <span className="chip">冷却 {status?.cooldown_days ?? '--'} 天</span>
          </div>
        </motion.section>

        {(error || success) && (
          <motion.div variants={staggerItem}>
            {error && <p className="alert error">{error}</p>}
            {success && <p className="alert success">{success}</p>}
          </motion.div>
        )}

        <motion.section variants={staggerItem} className="reset-grid">
          <div className="panel reset-primary-card">
            <div className="section-head">
              <h2 className="section-title">立即执行</h2>
            </div>
            {loading ? (
              <p className="loading-text">加载中...</p>
            ) : (
              <>
                <div className="reset-metric-stack">
                  <div className="reset-metric-card">
                    <span>当前余额</span>
                    <strong>{formatBalance(status?.current_balance)}</strong>
                  </div>
                  <div className="reset-metric-card">
                    <span>目标值</span>
                    <strong>{formatBalance(status?.target_balance)}</strong>
                  </div>
                  <div className="reset-metric-card accent">
                    <span>本次预计补差</span>
                    <strong>
                      {status
                        ? formatBalance(
                            Math.max(0, status.target_balance - status.current_balance)
                          )
                        : '--'}
                    </strong>
                  </div>
                </div>
                <p className="reset-notice-text">
                  {status?.notice || '当当前余额低于阈值时，可直接补到目标值。'}
                </p>
                {status?.next_available_at && !status.can_apply && (
                  <p className="muted">
                    下次可用时间：{formatAdminTime(status.next_available_at)}
                  </p>
                )}
                <button
                  className="button primary wide"
                  disabled={!status?.can_apply || applying}
                  onClick={handleApply}
                >
                  {applying ? '重置中...' : '立即补到目标值'}
                </button>
              </>
            )}
          </div>

          <div className="panel reset-side-card">
            <div className="section-head">
              <h2 className="section-title">最近一次结果</h2>
            </div>
            {!status?.latest_record ? (
              <div className="empty-state">还没有重置记录</div>
            ) : (
              <div className="reset-latest-card">
                <div className="reset-latest-row">
                  <span>执行时间</span>
                  <strong>{formatAdminTime(status.latest_record.created_at)}</strong>
                </div>
                <div className="reset-latest-row">
                  <span>执行状态</span>
                  {renderGrantTag(status.latest_record.grant_status)}
                </div>
                <div className="reset-latest-row">
                  <span>补差额度</span>
                  <strong>+{formatBalance(status.latest_record.granted_balance)}</strong>
                </div>
                <div className="reset-latest-row">
                  <span>结果余额</span>
                  <strong>{formatBalance(status.latest_record.new_balance)}</strong>
                </div>
              </div>
            )}
          </div>
        </motion.section>

        <motion.section variants={staggerItem} className="panel history-surface">
          <div className="section-head">
            <h2 className="section-title">重置记录</h2>
          </div>
          {history.length === 0 ? (
            <div className="empty-state">暂无重置记录</div>
          ) : (
            <div className="list">
              {history.map((item) => (
                <div key={item.id} className="list-item history-item-card detailed reset-history-item">
                  <div className="stack">
                    <strong>{formatAdminTime(item.created_at)}</strong>
                    <span className="muted">
                      {formatBalance(item.before_balance)} → {formatBalance(item.target_balance)}
                    </span>
                    {item.grant_error && (
                      <span className="muted reset-history-error">{item.grant_error}</span>
                    )}
                  </div>
                  {renderGrantTag(item.grant_status)}
                  <span className="fortune-reward-text">+{formatBalance(item.granted_balance)}</span>
                </div>
              ))}
            </div>
          )}
        </motion.section>
      </motion.div>
    </motion.div>
  );
}

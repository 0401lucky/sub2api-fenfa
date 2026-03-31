import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, isUnauthorizedError } from '../lib/api';
import { pageVariants, staggerContainer, staggerItem } from '../lib/animations';
import { formatAdminTime } from '../lib/admin-format';
import { renderGrantTag } from '../lib/welfare-display';
import { Icon } from '../components/Icon';
import type { ResetHistoryItem, ResetStatus } from '../types';

function formatBalance(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--';
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
    if (showLoading) setLoading(true);
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
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll(true);
  }, []);

  async function handleApply() {
    if (!status?.can_apply || applying) return;
    setApplying(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.applyReset();
      setSuccess(`重置成功，本次补差 ${result.granted_balance}，当前余额 ${result.new_balance}`);
      await loadAll();
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(`失败：${err instanceof Error && err.message ? err.message : '请稍后重试'}`);
      await loadAll();
    } finally {
      setApplying(false);
    }
  }

  return (
    <motion.div
      className="frontend-container"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
      >
        <motion.section variants={staggerItem} className="frontend-bento-hero">
          <h1 className="frontend-bento-title">
            <Icon name="grid" size={20} />
            额度探测与重置 (Quota Reset)
          </h1>
          <p className="frontend-bento-desc">检测当前授权额度，支持在可用配额消耗至指定跌速线之下时，无感补充至目标水准。</p>
          <div className="frontend-checkin-metrics">
            <div className="frontend-metric-item">
              <span className="frontend-metric-label">检测余额</span>
              <span className="frontend-metric-value">{formatBalance(status?.current_balance)}</span>
            </div>
            <div className="frontend-metric-item">
              <span className="frontend-metric-label">重置跌速线 (阈值)</span>
              <span className="frontend-metric-value">{formatBalance(status?.threshold_balance)}</span>
            </div>
            <div className="frontend-metric-item">
              <span className="frontend-metric-label">目标补满</span>
              <span className="frontend-metric-value">{formatBalance(status?.target_balance)}</span>
            </div>
            <div className="frontend-metric-item">
              <span className="frontend-metric-label">冷却周期</span>
              <span className="frontend-metric-value">{status?.cooldown_days ?? '--'} 天</span>
            </div>
          </div>
        </motion.section>

        {(error || success) && (
          <motion.div variants={staggerItem}>
            {error && <p className="alert error">{error}</p>}
            {success && <p className="alert success">{success}</p>}
          </motion.div>
        )}

        <motion.section variants={staggerItem} className="frontend-bento-grid">
          <div className="frontend-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="frontend-bento-title" style={{ fontSize: '16px' }}>执行器控制面板</div>
            
            {loading ? (
              <p className="loading-text">加载中...</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flexGrow: 1 }}>
                <div style={{ padding: '16px', background: 'var(--surface-0)', borderRadius: '12px', border: '1px solid var(--panel-border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '600' }}>状态标定</span>
                    <span style={{ fontSize: '12px', fontWeight: 'bold', color: status?.can_apply ? 'var(--teal)' : 'var(--rose)' }}>
                      {status?.can_apply ? '条件吻合 (Ready)' : '锁闭防御 (Locked)'}
                    </span>
                  </div>
                  <p style={{ fontSize: '13px', color: 'var(--ink-0)', margin: 0, fontWeight: '500' }}>
                    {status?.reason || '满足条件后可直接补到目标值。'}
                  </p>
                  {status?.next_available_at && !status.can_apply && (
                    <p style={{ fontSize: '12px', color: 'var(--ink-2)', margin: '8px 0 0' }}>
                      时钟限制解除：{formatAdminTime(status.next_available_at)}
                    </p>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '600' }}>本次预估落差</span>
                  <strong style={{ fontSize: '18px', color: status?.can_apply ? 'var(--teal)' : 'var(--ink-0)', fontFamily: 'var(--font-mono)' }}>
                    +{status ? formatBalance(Math.max(0, status.target_balance - status.current_balance)) : '--'}
                  </strong>
                </div>

                <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
                  <button
                    className={`button ${status?.can_apply ? 'primary' : 'ghost'} wide`}
                    disabled={!status?.can_apply || applying}
                    onClick={handleApply}
                    style={status?.can_apply ? { background: 'var(--ink-0)', borderColor: 'var(--ink-0)' } : {}}
                  >
                    {applying ? '申请执行中...' : '提交补差指令'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="frontend-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="frontend-bento-title" style={{ fontSize: '16px' }}>最近节点日志</div>
            {!status?.latest_record ? (
               <div className="empty-state" style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>暂无重置动作回执</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flexGrow: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px dashed var(--panel-border)' }}>
                  <span style={{ fontSize: '13px', color: 'var(--ink-2)' }}>时间戳</span>
                  <strong style={{ fontSize: '13px', color: 'var(--ink-0)' }}>{formatAdminTime(status.latest_record.created_at)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px dashed var(--panel-border)' }}>
                  <span style={{ fontSize: '13px', color: 'var(--ink-2)' }}>执行结论</span>
                  {renderGrantTag(status.latest_record.grant_status)}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px dashed var(--panel-border)' }}>
                  <span style={{ fontSize: '13px', color: 'var(--ink-2)' }}>填补幅度</span>
                  <strong style={{ fontSize: '14px', color: 'var(--teal)', fontFamily: 'var(--font-mono)' }}>+{formatBalance(status.latest_record.granted_balance)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '13px', color: 'var(--ink-2)' }}>平衡值更新</span>
                  <strong style={{ fontSize: '14px', color: 'var(--ink-0)', fontFamily: 'var(--font-mono)' }}>{formatBalance(status.latest_record.new_balance)}</strong>
                </div>
              </div>
            )}
          </div>
        </motion.section>

        {history.length > 0 && (
          <motion.section variants={staggerItem} className="frontend-bento-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="frontend-card" style={{ padding: '0', overflow: 'hidden' }}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(0,0,0,0.05)', background: 'var(--surface-0)' }}>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 'bold' }}>历史重置事件流</h3>
              </div>
              <div className="frontend-op-list" style={{ padding: '16px', gap: '8px' }}>
                {history.map((item) => (
                  <div key={item.id} className="frontend-op-item" style={{ padding: '12px 16px', background: 'var(--surface-0)', boxShadow: 'none' }}>
                    <div className="frontend-op-main">
                      <span className="frontend-op-title" style={{ fontSize: '14px' }}>{formatAdminTime(item.created_at)}</span>
                      <span className="frontend-op-sub">
                        {formatBalance(item.before_balance)} → {formatBalance(item.target_balance)}
                        {item.grant_error && ` (阻断: ${item.grant_error})`}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      {renderGrantTag(item.grant_status)}
                    </div>
                    <div className="frontend-op-tail">
                      <span style={{ fontWeight: '700', color: 'var(--ink-0)', fontFamily: 'var(--font-mono)', fontSize: '14px' }}>
                        +{formatBalance(item.granted_balance)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.section>
        )}

      </motion.div>
    </motion.div>
  );
}

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, isUnauthorizedError } from '../lib/api';
import { pageVariants, staggerContainer, staggerItem } from '../lib/animations';
import { formatAdminDate, formatAdminTime } from '../lib/admin-format';
import { getModeLabel, renderGrantTag } from '../lib/welfare-display';
import type { CheckinHistoryItem, RedeemHistoryItem } from '../types';

type HistoryTab = 'checkins' | 'redeems';

export function HistoryPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [activeTab, setActiveTab] = useState<HistoryTab>('checkins');
  const [checkins, setCheckins] = useState<CheckinHistoryItem[]>([]);
  const [redeems, setRedeems] = useState<RedeemHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function redirectToLogin() {
    await logout();
    navigate('/login', { replace: true });
  }

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError('');
      try {
        const [checkinRecords, redeemRecords] = await Promise.all([
          api.getCheckinHistory(),
          api.getRedeemHistory()
        ]);
        setCheckins(checkinRecords);
        setRedeems(redeemRecords);
      } catch (err) {
        if (isUnauthorizedError(err)) {
          await redirectToLogin();
          return;
        }

        setError(err instanceof Error ? err.message : '记录加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
        <motion.section variants={staggerItem} className="panel utility-hero">
          <span className="eyebrow">Activity Timeline</span>
          <h1 className="hero-title utility-title">记录总览</h1>
          <p className="lead utility-lead">签到和兑换记录统一在这里查看。</p>
          <div className="history-tabbar" role="tablist" aria-label="记录切换">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'checkins'}
              className={`history-tab ${activeTab === 'checkins' ? 'active' : ''}`}
              onClick={() => setActiveTab('checkins')}
            >
              签到记录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'redeems'}
              className={`history-tab ${activeTab === 'redeems' ? 'active' : ''}`}
              onClick={() => setActiveTab('redeems')}
            >
              兑换记录
            </button>
          </div>
        </motion.section>

        {error && (
          <motion.div variants={staggerItem}>
            <p className="alert error">{error}</p>
          </motion.div>
        )}

        <motion.section variants={staggerItem} className="panel history-surface">
          <div className="section-head">
            <h2 className="section-title">
              {activeTab === 'checkins' ? '签到流水' : '兑换流水'}
            </h2>
          </div>

          {loading ? (
            <p className="loading-text">加载中...</p>
          ) : activeTab === 'checkins' ? (
            checkins.length === 0 ? (
              <div className="empty-state">暂无签到记录</div>
            ) : (
              <div className="list">
                {checkins.map((item) => (
                  <div key={item.id} className="list-item history-item-card detailed">
                    <div className="stack">
                      <strong>{formatAdminDate(item.checkin_date)}</strong>
                      <span className="muted">
                        {formatAdminTime(item.created_at)} · {getModeLabel(item.checkin_mode)}
                      </span>
                      {item.blindbox_title && (
                        <span className="fortune-history-mark">抽中：{item.blindbox_title}</span>
                      )}
                    </div>
                    {renderGrantTag(item.grant_status)}
                    <span className="fortune-reward-text">+{item.reward_balance}</span>
                  </div>
                ))}
              </div>
            )
          ) : redeems.length === 0 ? (
            <div className="empty-state">暂无兑换记录</div>
          ) : (
            <div className="list">
              {redeems.map((item) => (
                <div key={item.id} className="list-item history-item-card detailed">
                  <div className="stack">
                    <strong>{item.redeem_code}</strong>
                    <span className="muted">
                      {formatAdminTime(item.created_at)} · {item.redeem_title}
                    </span>
                  </div>
                  {renderGrantTag(item.grant_status)}
                  <span className="fortune-reward-text">+{item.reward_balance}</span>
                </div>
              ))}
            </div>
          )}
        </motion.section>
      </motion.div>
    </motion.div>
  );
}

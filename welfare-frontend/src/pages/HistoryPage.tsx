import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, isUnauthorizedError } from '../lib/api';
import { pageVariants, staggerContainer, staggerItem } from '../lib/animations';
import { formatAdminDate, formatAdminTime } from '../lib/admin-format';
import { getModeLabel, renderGrantTag } from '../lib/welfare-display';
import { Icon } from '../components/Icon';
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
            <Icon name="chart" size={20} />
            历史流水 (Activity Log)
          </h1>
          <p className="frontend-bento-desc">追溯所有额度下发记录、操作时间和发放结果状态，数据仅限当前登录标识符。</p>
        </motion.section>

        {error && (
          <motion.div variants={staggerItem}>
            <p className="alert error">{error}</p>
          </motion.div>
        )}

        <motion.div variants={staggerItem} className="frontend-segmented">
          <button
            type="button"
            className={`frontend-segment-btn ${activeTab === 'checkins' ? 'active' : ''}`}
            onClick={() => setActiveTab('checkins')}
          >
            签到记录
            {activeTab === 'checkins' && <motion.div layoutId="history-tab" className="frontend-segment-highlight" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
          </button>
          <button
            type="button"
            className={`frontend-segment-btn ${activeTab === 'redeems' ? 'active' : ''}`}
            onClick={() => setActiveTab('redeems')}
          >
            兑换记录
            {activeTab === 'redeems' && <motion.div layoutId="history-tab" className="frontend-segment-highlight" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
          </button>
        </motion.div>

        <motion.section variants={staggerItem} className="frontend-bento-grid" style={{ gridTemplateColumns: '1fr' }}>
          {loading ? (
            <p className="loading-text" style={{ padding: '24px' }}>加载流水中...</p>
          ) : (
            <div className="frontend-op-list">
              <AnimatePresence mode="popLayout">
                {activeTab === 'checkins' && checkins.length === 0 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="empty-state">暂无签到记录</motion.div>
                )}
                {activeTab === 'checkins' && checkins.map((item) => (
                  <motion.div key={item.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="frontend-op-item">
                    <div className="frontend-op-main">
                      <span className="frontend-op-title">{formatAdminDate(item.checkin_date)}</span>
                      <span className="frontend-op-sub">
                        {formatAdminTime(item.created_at)} · {getModeLabel(item.checkin_mode)}
                        {item.blindbox_title && ` (抽中 ${item.blindbox_title})`}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      {renderGrantTag(item.grant_status)}
                    </div>
                    <div className="frontend-op-tail">
                      <span style={{ fontWeight: '700', color: 'var(--ink-0)', fontFamily: 'var(--font-mono)', fontSize: '15px' }}>
                        +{item.reward_balance.toFixed(2)}
                      </span>
                    </div>
                  </motion.div>
                ))}

                {activeTab === 'redeems' && redeems.length === 0 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="empty-state">暂无兑换记录</motion.div>
                )}
                {activeTab === 'redeems' && redeems.map((item) => (
                  <motion.div key={item.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="frontend-op-item">
                    <div className="frontend-op-main">
                      <span className="frontend-op-title">{item.redeem_code}</span>
                      <span className="frontend-op-sub">
                        {formatAdminTime(item.created_at)} · {item.redeem_title}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      {renderGrantTag(item.grant_status)}
                    </div>
                    <div className="frontend-op-tail">
                      <span style={{ fontWeight: '700', color: 'var(--ink-0)', fontFamily: 'var(--font-mono)', fontSize: '15px' }}>
                        +{item.reward_balance.toFixed(2)}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </motion.section>
      </motion.div>
    </motion.div>
  );
}

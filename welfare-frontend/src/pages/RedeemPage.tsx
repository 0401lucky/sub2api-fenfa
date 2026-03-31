import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../lib/auth';
import { api, isUnauthorizedError } from '../lib/api';
import { pageVariants, staggerContainer, staggerItem } from '../lib/animations';

export function RedeemPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [redeemCodeInput, setRedeemCodeInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function redirectToLogin() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function handleRedeem() {
    if (!redeemCodeInput.trim() || submitting) {
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const result = await api.redeemCode({
        code: redeemCodeInput.trim()
      });
      setRedeemCodeInput('');
      setSuccess(
        `兑换成功，${result.title} 已发放 ${result.reward_balance}，当前余额 ${result.new_balance ?? '未知'}`
      );
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }

      setError(
        `兑换失败：${err instanceof Error && err.message ? err.message : '请稍后重试'}`
      );
    } finally {
      setSubmitting(false);
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
            <Icon name="ticket" size={20} />
            凭证兑换 (Redeem Code)
          </h1>
          <p className="frontend-bento-desc">输入后台发放的活动码或补偿凭证，单次兑换的结果将在本页即刻回馈。</p>
        </motion.section>

        {(error || success) && (
          <motion.div variants={staggerItem}>
            {error && <p className="alert error">{error}</p>}
            {success && <p className="alert success">{success}</p>}
          </motion.div>
        )}

        <motion.div variants={staggerItem} className="frontend-bento-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="frontend-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', padding: '48px 24px' }}>
            <Icon name="ticket" size={32} style={{ color: 'var(--ink-2)', marginBottom: '8px' }} />
            <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>输入兑换码</h2>
            <div style={{ width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <input
                className="frontend-input-modern"
                type="text"
                value={redeemCodeInput}
                onChange={(event) => setRedeemCodeInput(event.target.value)}
                placeholder="例如：WELCOME100"
                disabled={submitting}
              />
              <button
                className="button primary wide"
                disabled={redeemCodeInput.trim() === '' || submitting}
                onClick={handleRedeem}
                style={{ padding: '14px', borderRadius: '12px', fontSize: '15px' }}
              >
                {submitting ? '校验中...' : '提交兑换'}
              </button>
            </div>
            <p className="frontend-bento-desc" style={{ marginTop: '16px', fontSize: '12px' }}>
              兑换流水将被单独记录，你可以在「记录」页查看全部历史流水。
            </p>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
